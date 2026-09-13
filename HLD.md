# YProctor — High-Level Design (HLD)

## 1. Overview

This document describes the high-level design of YProctor: a WebRTC-based proctoring system
with integrated exam management. It covers the logical components, how they interact, the
data and control flows, and the protocols in use. Lower-level implementation details (class
internals, algorithms, data structures) live in `LLD1.md`.

YProctor supports the full exam lifecycle — **exam definition**, **question-bank
population**, **candidate registration**, **exam-attempt creation** (question-paper
generation from a blueprint), **real-time proctored delivery** over peer-to-peer WebRTC,
and **result archival** — so that a proctor can observe one or more candidates in a shared
room over real-time video while all exam data is persisted in PostgreSQL.

## 2. Actors

| Actor    | Description                                                                    |
|----------|---------------------------------------------------------------------------------|
| Admin    | Creates exams (with blueprints), populates the question bank, manages accounts. |
| Candidate| A test-taker. Registers for an exam, logs in for a JWT + room, publishes media. |
| Proctor  | An exam supervisor. Joins the room and receives live video feeds of candidates. |
| Backend  | FastAPI + PostgreSQL. Authenticates participants, persists exam data, relays signals. |

A single room may host up to **5 candidates** and any number of proctors. Capacity is
enforced at WebSocket-connect time. A room only becomes active once a proctor joins it.

## 3. Logical Components

### 3.1 Backend (FastAPI + PostgreSQL)

The backend is organized into four cooperating layers:

```
                   ┌─────────────────────────────────────────────────────┐
                   │              FastAPI app (main.py)                     │
                   │  title="YProctor Signalling Server"                  │
                   └──────────────┬──────────────┬─────────────┬────────┘
                                  │              │             │
                    CORS mw        │              │   WS route  │   REST routes
                ┌──────────────────┘              │             │
                │                                  │             │
                ▼                                  ▼             ▼
   ┌──────────────────────────┐   ┌──────────────────────────┐   ┌─────────────────────────┐
   │  api.py  (REST router)    │   │  auth.py (JWT)           │   │  WebSocket signaling    │
   │  /api/                  │   │  /api/auth/             │   │  router (signaling.py)  │
   │  - /exams                │   │  - candidate/login       │   │  /ws/{room}/{role}/{id} │
   │  - /exam-register        │   │  - proctor/login         │   │  ?token=JWT             │
   │  - /candidates           │   │  - /me                  │   │                         │
   │  - /proctors             │   │  decode & verify JWT    │   │                         │
   │  - /proctor/rooms        │   │                          │   │                         │
   │  Exam Engine logic      │   │                          │   │                         │
   └────────┬─────────────────┘   └──────────────────────────┘   └────────┬────────────────┘
            │                                                        │
            │                                                            │
            ▼                                                            ▼
   ┌──────────────────────────┐   ┌──────────────────────────────────────────┐
   │  models.py (SQLAlchemy)   │   │  RoomService (in-memory presence)         │
   │  - Candidate             │   │  services/room_service.py                 │
   │  - Proctor               │   │  - Room / Participant dataclasses         │
   │  - Admin                 │   │  - room_service singleton                 │
   │  - QuestionBank          │   │  - MAX_CANDIDATES_PER_ROOM = 5            │
   │  - Exam                  │   │  - room active/deactivate lifecycle       │
   │  - ExamRegister          │   │                                            │
   │  - ExamAttempt           │   │  ConnectionManager (WebSocket relay)      │
   │  - ExamResult            │   │  websocket/manager.py                     │
   │                          │   │  - keyed by (room, role, id)             │
   └────────┬─────────────────┘   │  - connection_manager singleton          │
            │                      └──────────────────────────────────────────┘
            ▼                    ┌──────────────────┐
   ┌──────────────────┐         │  PostgreSQL DB    │
   │  db.py            │         │  (create_engine)  │
   │  - engine         │─────────│  - all exam tables  │
   │  - SessionLocal    │         │  - SQLAlchemy ORM   │
   │  - Base            │         └──────────────────┘
   │  - get_db          │
   │  - init_db         │
   └──────────────────┘
```

**Key characteristics:**
- **REST layer** (`api.py`) is stateless — each request receives a DB session via `Depends(get_db)`.
- **WebSocket layer** (`signaling.py`) is stateful — holds a long-lived connection per participant
  with JWT-based authentication on connect.
- **Exam Engine** (within `api.py`) handles question-paper generation, answer saving, scoring,
  and result archival via the ORM.
- **Room presence** is in-memory only (`RoomService`, `ConnectionManager`) — restart clears active
  room state but exam data persists in PostgreSQL.

## 4. Exam Process Flow

The exam lifecycle spans the REST API, the database, and the WebSocket signaling plane.

```
  [Admin]                [Backend / DB]              [Candidate browser]        [Proctor browser]
     │                        │                            │                           │
     │ POST /api/exams        │                            │                           │
     ├────────────────────────►  creates exams row        │                           │
     │ (blueprint, window)    │                            │                           │
     │                        │                            │                           │
     │ populate question_bank │                            │                           │
     ├────────────────────────►  creates question_bank rows│                           │
     │                        │                            │                           │
     │ POST /api/exam-register│                            │                           │
     ├────────────────────────►  creates exam_register row│                           │
     │                        │                            │                           │
     │                        │                            │                           │
     │                        │                            │ POST /api/auth/candidate/ │                           │
     │                        │                            │ login → JWT + room_no    │                           │
     │                        │                            │◄─────────────────────────┤                           │
     │                        │                            │                            │                           │
     │                        │                            │ WS /ws/{room}/candidate/ │                           │
     │                        │                            │ {id}?token=JWT            │                           │
     │                        │                            │◄─────────────────────────┤                           │
     │                        │                            │ (JWT validation +       │                           │
     │                        │                            │  room-active check)     │                           │
     │                        │                            │                            │                           │
     │                        │   [attempt start]          │                            │                           │
     │                        ├───────────────────────────► creates exam_attempts row│                           │
     │                        │   qp_json ← blueprint      │                            │                           │
     │                        │   answers = {}             │                            │                           │
     │                        │                            │                            │                           │
     │                        │  WebRTC signaling (P2P)     │◄─────────────────────────►│                           │
     │                        │  (offer/answer/ICE relay)  │     camera+mic+screen      │                           │
     │                        │                            │                            │                           │
     │                        │  answer & submit           │                            │                           │
     │                        ◄────────────────────────────┤ updates answers JSONB,   │                           │
     │                        │  computes score            │ computes score,          │                           │
     │                        │  status → submitted        │ status → submitted       │                           │
     │                        │                            │                            │                           │
     │                        │  archives to exam_results  │                            │                           │
     │                        ├───────────────────────────►│                            │                           │
     │                        │                            │                            │                           │
```

### Phases at a glance

| Phase | Trigger | Actor | Backend action | DB write |
|-------|---------|-------|----------------|----------|
| Exam setup | POST /api/exams | Admin | Validate blueprint, create Exam | `exams` |
| Question bank | Admin populates | Admin | Add questions per exam | `question_bank` |
| Registration | POST /api/exam-register | Candidate | Validate exam+candidate, create ExamRegister | `exam_register` |
| Login | POST /api/auth/candidate/login | Candidate | Verify credentials, issue JWT, resolve room | — (read-only query) |
| Proctoring | WS connect | Candidate + Proctor | JWT verify, room-active check, relay signals | none (in-memory) |
| Attempt start | Candidate opens exam | Candidate | Pick questions by blueprint, create ExamAttempt | `exam_attempts` (qp_json snapshot) |
| Answering | UI action | Candidate | Update answers JSONB | `exam_attempts.answers` |
| Submission | Candidate submits | Candidate | Score, set submitted_at, status | `exam_attempts` (score, submitted_at, status) |
| Result archival | Post-submit | Backend | Compute totals, write denormalized result | `exam_results` |


## 5. Data & Control Flow

### Data Flow

1. **Static data** (exams, question_bank, candidates, proctors, registrations, attempts, results)
   flows between the React SPA and the FastAPI REST API over HTTPS, landing in PostgreSQL via
   SQLAlchemy ORM.
2. **Signalling data** (SDP offers/answers, ICE candidates, presence, media-status) flows over
   a JWT-authenticated WebSocket to the in-memory `ConnectionManager`, which relays messages
   between browser peers.
3. **Media** (camera video, microphone audio, screen share) flows browser-to-browser over WebRTC
   P2P and **never** touches the backend server.

### Control Flow

- **Candidate**: Login → receives JWT + room → WebSocket connect (JWT verified) → system check
  (camera/mic/screen) → enter room → WebRTC with proctors → attempt starts (qp_json built) →
  answer questions → submit (score computed) → results archived.
- **Proctor**: Login → receives JWT → fetches active rooms → WebSocket connect to chosen room
  → receives `candidate-list` → for each candidate, receive `request-offer` → answer with
  `offer`/`answer`/`ice-candidate` → consume media tracks.
- **Admin**: POST candidates/proctors/exams, populate question_bank — all via REST.

## 6. Signalling Message Protocol

All signalling messages are plain JSON objects with a `type` field, exchanged over the
WebSocket. The connection URL carries the JWT as a query parameter:
`/ws/{room}/{role}/{id}?token=<JWT>`. The backend validates the token's `role` and `sub`
(subject) claims against the URL path before accepting the connection.

```
{ type: "request-offer",  from: "<proctor_id>" }
{ type: "offer",          from: "<proctor_id>", to: "<candidate_id>", payload: { sdp, type } }
{ type: "answer",         from: "<candidate_id>", to: "<proctor_id>", payload: { sdp, type } }
{ type: "ice-candidate",  from: "...", to: "...", payload: { candidate, sdpMid, sdpMLineIndex } }
{ type: "media-status",   payload: { camera, microphone, screen, webrtc } }
{ type: "candidate-list" / "candidate-joined" / "candidate-left" /
  "candidate-media-status" / "proctor-left" / "room-full" / "room-not-started" | "ping" / "pong" }
```

Direction rules enforced by the backend:
- `offer` / `answer` / `ice-candidate` are always relayed from `role` → opposite role.
- `media-status` is only accepted from candidates and is broadcast to all proctors in the room.

## 7. REST Endpoints

| Method | Path                          | Auth    | Description                                      |
|--------|-------------------------------|---------|--------------------------------------------------|
| POST   | `/api/auth/candidate/login`   | none    | Verify email/password, issue JWT + room.         |
| POST   | `/api/auth/proctor/login`     | none    | Verify email/password, issue JWT.                |
| GET    | `/api/auth/me`                | bearer  | Return current profile (used to restore session).|
| GET    | `/`                           | none    | Health check.                                     |
| GET    | `/api/rooms/{room_id}`        | none    | Room presence snapshot (candidate/proctor counts).|
| POST   | `/api/candidates`             | none    | Create a candidate.                               |
| GET    | `/api/candidates`             | none    | List all candidates.                              |
| GET    | `/api/candidates/{id}/exams`  | none    | List a candidate's registrations + exam details.  |
| POST   | `/api/proctors`               | none    | Create a proctor.                                 |
| GET    | `/api/proctors`               | none    | List all proctors.                                |
| GET    | `/api/proctor/rooms`          | bearer  | Active rooms with candidate counts (proctor only).|
| POST   | `/api/exams`                  | none    | Create an exam (with blueprint).                  |
| GET    | `/api/exams`                  | none    | List all exams.                                   |
| POST   | `/api/exam-register`          | none    | Register a candidate for an exam.                |


## 8. Security Considerations (POC-level)

- **JWT authentication.** All participants receive an HMAC-SHA256 JWT (12-hour expiry) on
  login. REST endpoints requiring auth use `Authorization: Bearer <token>`; the WebSocket
  endpoint receives the token as `?token=<JWT>`. The backend validates the `role` and `sub`
  claims against the URL path on connect.
- **Transport security** — HTTPS/WSS enforced by the runtime; a page on `https://` can only
  open `wss://` (the frontend matches scheme to protocol). Self-signed certs via
  `generate-certs.sh` are used for LAN dev.
- **CORS** — deliberately wide-open for the POC; not production-safe.
- **Passwords** — stored and compared as plaintext. This is a known, deliberate MVP gap.
- **Room capacity** — the backend rejects the 6th candidate WebSocket with `room-full` (code 4403).
- **Room gating** — a candidate cannot join a room until a proctor has started it (code 4404).

## 9. Scaling & Performance Characteristics

| Axis            | Current (POC)                  | Notes                                                    |
|-----------------|--------------------------------|----------------------------------------------------------|
| Concurrency     | Single Uvicorn worker, asyncio | Fine for ≤ a handful of rooms. Each WS is I/O-bound.     |
| Rooms           | In-memory dict                 | No sharding; all rooms share one process.                |
| Media bandwidth  | 0 through server               | WebRTC is P2P — server bandwidth does not scale with media.|
| Peer connections | C×P per room                   | A candidate makes one RTCPC per proctor; a proctor one per candidate.|
| Exam data       | PostgreSQL                     | Persistent; scales independently of signaling.           |
| Memory (presence)| Streams held only in browsers  | Server holds only small JSON + WebSocket objects per room.|

## 10. Deployment Modes

| Mode        | How to run                                                         |
|-------------|--------------------------------------------------------------------|
| Local/dev   | `uvicorn app.main:app --reload --port 8000`; `npm run dev` (HTTP on localhost). |
| LAN testing | `./generate-certs.sh <lan-ip>`, backend with `--ssl-keyfile/--ssl-certfile`, `npm run dev -- --host` (auto-HTTPS). |

---

*See `architecture.md` for the at-a-glance overview and `LLD1.md` for module-level internals.*

