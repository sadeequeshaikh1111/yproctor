# YProctor — High-Level Design (HLD)

## 1. Overview

This document describes the high-level design of the YProctor WebRTC proctoring POC: the logical
components, how they interact, the data and control flows, and the protocols in use. Lower-level
implementation details (class internals, algorithms, data structures) live in `LLD.md`.

YProctor enables a **proctor** to observe one or more **candidates** in a shared *room* over
real-time video, with camera, microphone, and screen-sharing tracks delivered **peer-to-peer**
via WebRTC, while a FastAPI signalling server merely orchestrates the connection handshake and
tracks presence.

## 2. Actors

| Actor    | Description                                                                 |
|----------|-----------------------------------------------------------------------------|
| Candidate| A test-taker. Grants camera + mic + screen permissions and *publishes* three media tracks to each proctor. |
| Proctor  | An exam supervisor. *Receives* and renders the live camera + screen feeds of every candidate in the room. |
| Backend  | A FastAPI + Uvicorn signalling server. Relays JSON control messages and tracks in-room presence. |

A single room may host up to **5 candidates** and any number of proctors. Capacity is enforced at
WebSocket-connect time.

## 3. Logical Components

### 3.1 Backend (FastAPI Signalling Server)

The backend is organized into three layers:

```
                       ┌─────────────────────────────────────┐
                       │              FastAPI app             │
                       │              (main.py)               │
                       └──────────────┬──────────┬──────────┘
                                      │          │
                 CORS middleware      │          │
               ┌─────────────────┐    │          │   WS route
               │  REST endpoints │    │          │   /ws/{room}/{role}/{id}
               │  GET /          │    │          │   (signaling.py)
               │  GET /api/      │    │          │
               │    rooms/{id}   │    │          │
               └─────────────────┘    │          │
                                      │          │
                          ┌──────────┘          │
                          ▼                     ▼
        ┌─────────────────────────┐   ┌──────────────────────────┐
        │   RoomService           │   │  ConnectionManager       │
        │  (room_service.py)      │   │   (manager.py)           │
        │ • Room registry         │   │ • WebSocket registry     │
        │ • Participant state     │   │ • send_to()              │
        │ • Media status          │   │ • broadcast_to_role()   │
        │ • Capacity (max 5)      │   │ • lookup by key          │
        └─────────────────────────┘   └──────────────────────────┘
```

**Key characteristics:**
- **Stateless HTTP** — REST endpoints (`GET /`, `GET /api/rooms/{room_id}`) are side-effect-free
  queries.
- **Stateful WebSocket** — the signalling endpoint holds a long-lived connection per participant.
- **In-memory only** — both `RoomService` and `ConnectionManager` are module-level singletons;
  no persistence layer.
- **Single-threaded event loop** — Uvicorn's asyncio model means there are no race conditions
  between message handling within one connection; cross-connection ordering is sequential.

### 3.2 Frontend (React SPA)

The frontend is a Single-Page Application built with React 18, TypeScript, Vite, and React
Router. It is split into four pages and a set of shared components and services.

**Page / Route map**

| Route                    | Role      | Purpose                                                        |
|--------------------------|-----------|----------------------------------------------------------------|
| `/login`                 | both      | Choose role (candidate/proctor), enter ID + room name. Stores `Identity` in `sessionStorage`. |
| `/candidate/instructions`| candidate | Pre-exam flow: check camera, check screen, give consent, then start WebRTC. |
| `/candidate/room`        | candidate | Exam screen: renders placeholder multiple-choice questions + own connection status. |
| `/proctor/room`          | proctor   | Live dashboard: grid of candidate cards + focused detail view. |

**Cross-cutting state: the candidate session singleton.**
The candidate side uses a **module-level singleton** (`candidateSession` in
`services/candidateSession.ts`) for the WebSocket connection, captured media streams, and
`RTCPeerConnection` objects. This lets them survive navigation from `/candidate/instructions`
to `/candidate/room` (a fresh React tree in the same tab) without re-acquiring camera/mic
permissions or renegotiating WebRTC. A small React hook (`useCandidateSession`) subscribes the
UI to status changes so re-renders fire when media / WebRTC state changes.

The proctor does **not** use a singleton — its state lives in component state / refs local to
`Proctorroom`, because the proctor page is a terminal view with no further navigation.

## 4. Data Flows

### 4.1 Join flow (candidate)

```
1.  Login page   ──► sessionStorage.setItem("yproctor:identity", Identity)
2.  Instructions ──► candidateSession.ensureConnected(identity)
3.  SignalingClient.connect() ──► WebSocket opens  /ws/{room}/candidate/{id}
4.  Backend accepts  ──► RoomService.add_candidate()
5.  Backend broadcast  "candidate-joined" ──► all proctors in room
6.  For each proctor already present:
        Backend sends "request-offer" ──► candidate
7.  Media checks: getCameraAndMic(), getScreenShare()
8.  consent + checks pass ──► session.startWebRTC()
        ──► CandidatePeerManager created
        ──► pending request-offer messages replayed
```

### 4.2 Join flow (proctor)

```
1.  Login page   ──► sessionStorage.setItem("yproctor:identity", Identity)
2.  ProctorRoom  ──► SignalingClient.connect() ──► WebSocket opens /ws/{room}/proctor/{id}
3.  Backend accepts  ──► RoomService.add_proctor()
4.  Backend sends "candidate-list" ──► this proctor (snapshot of all candidates)
5.  For each candidate already present:
        Backend sends "request-offer" ──► candidate
6.  Candidate creates RTCPC, sets local offer, sends "offer" back
7.  ProctorPeerManager.handleOffer()   ──► sets remote, creates+sets local answer, sends "answer"
8.  ICE candidates exchanged via "ice-candidate" messages (trickle ICE)
9.  "onictrack" fires  ──► MediaPanel receives MediaStream  ──► <video> renders
```

### 4.3 WebRTC negotiation ladder

```
Candidate                        Backend (relay)            Proctor
   │                                │                           │
   │ request-offer (from: P001)     │                           │
   ◄───────────────────────────────                             │
   │  (triggers offer creation)                                │
   │ offer (to P001)        ──────► │ ──────►  offer            │
   │                                │  (from: C001)            │
   │                                 ◄──────────────────────────│
   │                               answer (to C001)            │
   │ ◄────── │ ◄──────────────────  answer                      │
   │        │  (from: P001)        │                            │
   │ ice ───┼───► ice ──────────────► ice ─────────────────►    │
   │        │                            (from: P001)          │
   │  ... media flows P2P (camera+mic+screen) ...              │
```

### 4.4 Departure flow

| Who leaves | Backend actions                                                              |
|------------|------------------------------------------------------------------------------|
| Candidate  | `remove_candidate()`; broadcast `candidate-left` to proctors; proctor-side `ProctorPeerManager.handleCandidateLeft()` closes the PC. |
| Proctor    | `remove_proctor()`; send `proctor-left` to each candidate; candidate-side `CandidatePeerManager.handleProctorLeft()` closes the PC. |

### 4.5 Media status flow

```
Candidate sets getUserMedia/getDisplayMedia  ──►  status: { camera: "connected", ... }
candidateSession.sendStatus()  ──►  "media-status"  ──►  Backend
Backend  ──►  "candidate-media-status" broadcast  ──►  all proctors
Proctor UI updates the ConnectionStatus indicators on each candidate card.
```

## 5. Protocols & Message Schema

### 5.1 Signalling protocol summary

| Message type                | Direction (sender→receiver) | Payload                              |
|-----------------------------|-----------------------------|--------------------------------------|
| `request-offer`             | proctor→backend→candidate   | `{ from: "<proctor_id>" }`           |
| `offer`                     | candidate→backend→proctor   | `{ from, to, payload: SDPOffer }`    |
| `answer`                    | proctor→backend→candidate   | `{ from, to, payload: SDPAnswer }`   |
| `ice-candidate`             | either→backend→opposite     | `{ from, to, payload: IceInit }`     |
| `media-status`              | candidate→backend           | `{ payload: MediaStatus }`           |
| `candidate-list`            | backend→proctor             | `[{ id, mediaStatus }]`              |
| `candidate-joined`          | backend→proctors            | `{ id, mediaStatus }`                |
| `candidate-left`            | backend→proctors            | `{ id }`                             |
| `candidate-media-status`    | backend→proctors            | `{ id, mediaStatus }`                |
| `proctor-left`              | backend→candidates          | `{ id }`                             |
| `room-full`                 | backend→candidate           | — (closes conn, code 4403)           |
| `ping` / `pong`             | either↔backend              | —                                    |

### 5.2 REST endpoints

| Method | Path                     | Auth | Description                                      |
|--------|--------------------------|------|--------------------------------------------------|
| GET    | `/`                      | none | Health check: `{"status":"ok","service":"yproctor-signalling"}` |
| GET    | `/api/rooms/{room_id}`   | none | Room presence snapshot: candidate/proctor counts, capacity, full flag. |

## 6. Security Considerations (POC-level)

- **Transport security** — HTTPS/WSS enforced by the runtime; a page on `https://` can only
  open `wss://` (the frontend matches scheme to protocol). Self-signed certs via
  `generate-certs.sh` are used for LAN dev.
- **CORS** — deliberately wide-open for the POC; not production-safe.
- **No authn/authz** — participant identity is self-asserted via the URL path segment
  (`/ws/{room}/{role}/{id}`). See limitations in `architecture.md`.
- **Capacity guard** — the backend rejects the 6th candidate WebSocket with `room-full`.

## 7. Scaling & Performance Characteristics

| Axis            | Current (POC)                  | Notes                                                    |
|-----------------|--------------------------------|----------------------------------------------------------|
| Concurrency     | Single Uvicorn worker, asyncio | Fine for ≤ a handful of rooms. Each WS is I/O-bound.     |
| Rooms           | In-memory dict                 | No sharding; all rooms share one process.                |
| Media bandwidth  | 0 through server               | WebRTC is P2P — server bandwidth does not scale with media. |
| Peer connections | C×P per room                   | A candidate makes one RTCPC per proctor; a proctor one per candidate. |
| Memory          | Streams held only in browsers  | Server holds only small JSON + WebSocket objects.        |

## 8. Deployment Modes

| Mode        | How to run                                                                 |
|-------------|----------------------------------------------------------------------------|
| Local/dev   | `uvicorn app.main:app --reload --port 8000`; `npm run dev` (HTTP on localhost — secure context). |
| LAN testing | `./generate-certs.sh <lan-ip>`, backend with `--ssl-keyfile/--ssl-certfile`, `npm run dev -- --host` (auto-HTTPS via `vite.config.ts`). |

---

*See `architecture.md` for the at-a-glance overview and `LLD.md` for module-level internals.*