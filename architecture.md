# YProctor — Architecture Overview

## 1. Purpose & Scope

**YProctor** is a WebRTC-based proctoring **proof-of-concept** (POC). It demonstrates that multiple
candidates can enter assigned *rooms*, enable camera / microphone / screen-sharing, establish **direct
peer-to-peer WebRTC** connections with the browser(s) of one or more proctors, and have the proctor(s)
view each candidate's live video feeds.

> **Important scope note.** This is *not* the production product. It deliberately omits
> authentication, a database, exam/recording/reporting logic, and media persistence. Everything
> lives in process memory and resets when the backend restarts.

## 2. High-Level Architecture

```
┌──────────────────┐   WebSocket (JSON signalling)   ┌──────────────────┐
│  Candidate(s)    │◄──────────────────────────────►│   Proctor(s)     │
│  browser tab(s)  │   FastAPI signalling server    │  browser tab(s)  │
│                  │                                 │                  │
│  • getUserMedia  │  signalling / room presence     │  • <video> render│
│  • getDisplayMedia│  (FastAPI + Uvicorn)           │  • RTCPC recv    │
│  • RTCPeerConn   │                                 │  • RTCPeerConn   │
└────────┬─────────┘                                 └────────▲─────────┘
         │                                                        │
         └──────────────────── WebRTC media (P2P) ────────────────┘
           (camera + mic + screen tracks flow browser↔browser,
            NEVER touching the backend)
```

### Two-plane design

| Plane             | Transport        | What it carries                                          | Component              |
|-------------------|------------------|----------------------------------------------------------|------------------------|
| **Signalling**    | WebSocket + JSON | Presence, SDP offers/answers, ICE candidates            | FastAPI backend        |
| **Media**         | WebRTC P2P       | Camera video, microphone audio, screen-share video      | Browser ↔ Browser      |

The backend **only** relays signalling/control messages. Once a peer connection is established,
all audio/video traffic flows directly between browsers and never passes through the server.

## 3. Technology Stack

| Layer        | Technology                          | Notes                                          |
|--------------|-------------------------------------|------------------------------------------------|
| Backend      | **Python 3.10+**                    | Signalling server                              |
| Backend      | **FastAPI 0.115**                   | WebSocket + REST endpoints                     |
| Backend      | **Uvicorn** (standard)              | ASGI server + `--reload` dev mode              |
| Frontend     | **React 18.3** + **TypeScript 5.5**| SPA                                              |
| Frontend     | **Vite 5.4**                        | Dev server + bundler                           |
| Frontend     | **React Router DOM 6.26**           | Client-side routing                             |
| WebRTC       | Native browser `RTCPeerConnection`| STUN-only (`stun:stun.l.google.com:19302`)      |

There are **no** external databases, message queues, CDNs, or build-step tooling beyond Vite + tsc.

## 4. Project Layout

```
yproctor/
├── README.md                 # User-facing documentation (run / configure / limitations)
├── generate-certs.sh         # Generates a self-signed cert for LAN HTTPS testing
├── certs/                    # Auto-generated cert.pem / key.pem (git-ignored)
│   ├── cert.pem
│   └── key.pem
├── backend/
│   ├── requirements.txt      # fastapi==0.115.0, uvicorn[standard]==0.30.6, websockets==13.1
│   └── app/
│       ├── main.py           # App factory: CORS, routers, health-check + room-status REST
│       ├── __init__.py
│       ├── services/
│       │   ├── room_service.py   # RoomService singleton — in-memory room/participant state
│       │   └── __init__.py
│       └── websocket/
│           ├── manager.py        # ConnectionManager — live WebSocket bookkeeping
│           ├── signaling.py      # /ws/{room}/{role}/{id} endpoint — signalling relay logic
│           └── __init__.py
└── frontend/
    ├── index.html
    ├── package.json            # React 18, Vite, TypeScript, React Router
    ├── tsconfig.json
    ├── vite.config.ts          # Dev server: port 5173, HTTPS when certs present
    └── src/
        ├── main.tsx            # React 18 root + StrictMode + BrowserRouter
        ├── App.tsx             # Route definitions (/login, /candidate/*, /proctor/*)
        ├── types/index.ts      # Shared TS types (Identity, Role, MediaStatus, SignalMessage …)
        ├── services/
        │   ├── websocket.ts       # SignalingClient — thin WebSocket wrapper (JSON in/out)
        │   ├── candidateSession.ts # singleton candidateSession — survives route navigation
        │   └── webrtc.ts           # CandidatePeerManager & ProctorPeerManager (WebRTC)
        ├── components/
        │   ├── MediaPanel.tsx        # <video> element bound to a MediaStream
        │   ├── ConnectionStatus.tsx  # Coloured dot + label status indicator
        │   └── CandidateCard.tsx     # Proctor's per-candidate summary card
        └── pages/
            ├── Login.tsx            # Role + ID + room entry form
            ├── Instructions.tsx       # Pre-exam: check cam/mic, consent, start WebRTC
            ├── CandidateRoom.tsx      # Exam UI: questions + own connection status
            └── ProctorRoom.tsx        # Proctor dashboard: candidate grid + focused view
```

## 5. Participant Roles & Topology

- **Candidate** — publishes three tracks (camera video, microphone audio, screen-share video).
  Each candidate opens *one* `RTCPeerConnection` **per proctor** watching the room (a send-only
  publisher model). This keeps each proctor's connection independent and makes teardown simple
  when a proctor leaves.
- **Proctor** — *receives* the candidate tracks. Each proctor opens one `RTCPeerConnection` **per
  candidate** in the room and consumes the media.

> **Why N×M connections?** A candidate never connects to other candidates; a proctor never
> connects to other proctors. The mesh is strictly candidate→proctor, so with *C* candidates and
> *P* proctors there are *C×P* peer connections — each media flow is direct browser-to-browser.

## 6. Signalling Message Protocol

All messages are plain JSON objects with a `type` field, exchanged over the WebSocket.

```
{ type: "request-offer",  from: "<proctor_id>" }
{ type: "offer",          from: "<proctor_id>", to: "<candidate_id>", payload: { sdp, type } }
{ type: "answer",         from: "<candidate_id>", to: "<proctor_id>", payload: { sdp, type } }
{ type: "ice-candidate",  from: "...", to: "...", payload: { candidate, sdpMid, sdpMLineIndex } }
{ type: "media-status",   payload: { camera, microphone, screen, webrtc } }
{ type: "candidate-list" / "candidate-joined" / "candidate-left" /
  "candidate-media-status" / "proctor-left" / "room-full" | "ping" / "pong" }
```

Direction rules enforced by the backend:
- `offer` / `answer` / `ice-candidate` are always relayed from `role` → opposite role.
- `media-status` is only accepted from candidates and is broadcast to all proctors in the room.

## 7. Key Design Decisions & Conventions

1. **In-memory only.** `RoomService` and `ConnectionManager` are module-level singletons living
   in the backend process. No DB, no Redis, no persistence. Restart = fresh state.
2. **STUN-only WebRTC.** No TURN server. Works out-of-the-box on the open internet or on
   `localhost`/same-LAN; connections behind symmetric NATs/firewalls may fail.
3. **Secure-context awareness.** `getDisplayMedia()` / `getUserMedia()` require `https://` or
   `http://localhost`. `generate-certs.sh` + `vite.config.ts` auto-enable HTTPS dev serving
   when certs are present, so the app works from a phone on the LAN.
4. **WebSocket base resolution.** The frontend derives `ws://` vs `wss://` from the page's own
   protocol — a page served over HTTPS can only open `wss://`, so the scheme is matched to avoid
   silent mixed-content blocking.
5. **Candidate session singleton.** The candidate side keeps a module-level `candidateSession`
   object so the WebSocket connection, media streams, and `RTCPeerConnection`s survive navigation
   from the Instructions page to the exam Room page (a fresh React tree in the same tab).
6. **Connection-guarded onboarding.** `ensureConnected()` uses an in-flight promise
   (`connectPromise`) so React 18 StrictMode's double-invoke in dev (or fast route re-entry)
   cannot open a *second* WebSocket for the same candidate identity — which would race on the
   backend and wrongly evict presence.
7. **Room capacity.** Fixed at 5 candidates, enforced at WebSocket connect time in the backend.

## 8. Limitations & Non-Goals (reiterated)

- No authentication — anyone can enter any ID/room.
- No database — all state is ephemeral process memory.
- No TURN — peer connectivity is best-effort depending on NAT topology.
- No recording, exam logic (beyond 3 placeholder questions), or reporting.
- CORS is wide-open (`allow_origins=["*"]`) — dev/POC only.

---

*See `HLD.md` for the high-level design (component decomposition, data flows, protocols) and
`LLD.md` for the low-level design (module-level details, key algorithms, and data models).*
