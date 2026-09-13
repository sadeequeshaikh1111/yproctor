# YProctor — Architecture Overview

## 1. Purpose & Scope

**YProctor** is a WebRTC-based proctoring system with integrated exam management. It supports
the complete exam lifecycle: **exam definition**, **question-bank management**, **candidate
registration**, **exam-attempt creation** (question-paper generation from a blueprint),
**real-time proctored delivery** over peer-to-peer WebRTC, and **result archival**.

A **proctor** can observe multiple **candidates** in a shared *room* over real-time video,
with camera, microphone, and screen-sharing tracks delivered directly browser-to-browser via
WebRTC. A FastAPI backend authenticates participants with JWT, persists all exam data in
PostgreSQL, and orchestrates the WebRTC connection handshake.

### Exam Process Flow (at-a-glance)

```
  Admin                         Backend / DB
   |                              |
   |  POST /api/exams             |
   +---> creates  Exam            |          (blueprint, time window)
   |  (populate question_bank)    |
   |                              |
  Candidate                      |
   |                              |
   |  POST /api/exam-register      |
   +---> creates  exam_register row
   |                              |
   |  POST /api/auth/candidate/login  --> JWT + room assignment
   |                              |
   |  WS /ws/{room}/candidate/{id}?token=JWT  <-- WebRTC signaling
   |                              |
   |  [attempt start]             |
   +---> creates  exam_attempts row
   |  qp_json <-- questions picked |          from question_bank by blueprint
   |  answers = {}                |
   |                              |
   |  answer & submit             |
   +---> updates answers JSONB,   |          computes score, archives results
```

## 2. High-Level Architecture

```
                        ┌──────────────────────────────────────┐
                        │   FastAPI Backend (Uvicorn / ASGI)   │
                        │                                        │
 ┌──────────────┐  REST │  ┌──────────────┐ ┌─────────────┐     │
 │   Admin       │<-----┘  │  api.py      │ │ auth.py     │     │
 │ (management)  │       │  │  (REST CRUD) │ │ (JWT auth)  │     │
 └──────┬───────┘       │  └──────┬───────┘ └──────┬──────┘     │
        │                 │        │              │             │
 ┌──────▼───────┐ REST   │  ┌──────▼────────────────▼────┐      │
 │  Candidate   │<───────┘  │  Exam Engine                 │      │
 │  browser      │       │  │  (blueprint→qp_json,         │      │
 └──────┬───────┘       │  │   scoring, result archival)  │      │
        │ WS (JWT)      │  └──────────────┬───────────────┘      │
        │                 │               │                      │
┌────────▼────────┐      │  ┌────────────▼─────────────┐        │
│  Proctor         │<─WS─┘  │ RoomService                │        │
│  browser          │      │ (in-memory presence)        │        │
└──────────────────┘      │ ConnectionManager          │        │
                           │ (WebSocket relay)          │        │
                          └────────────┬───────────────┘        │
                                       │                          │
                          ┌────────────▼──────────────┐         │
                          │  PostgreSQL               │         │
                          │  (SQLAlchemy ORM)         │         │
                          │                           │         │
                          │  candidates                │         │
                          │  proctors / admins         │         │
                          │  exams                    │         │
                          │  question_bank             │         │
                          │  exam_register             │         │
                          │  exam_attempts             │         │
                          │  exam_results              │         │
                          └─────────────────────────────┘        │
                        └──────────────────────────────────────┘

 ┌──────────────────┐   WebRTC P2P (camera + mic + screen)   ┌──────────────────┐
 │  Candidate       │<──────────────────────────────────────>│  Proctor         │
 │  browser         │   media NEVER touches the backend      │  browser         │
 └──────────────────┘                                        └──────────────────┘
```


## 3. Technology Stack

| Layer       | Technology                             | Notes                                                     |
|-------------|----------------------------------------|-----------------------------------------------------------|
| Backend     | Python 3.10+                           | Signalling server + exam engine                           |
| Backend     | FastAPI 0.115                          | WebSocket + REST endpoints                                |
| Backend     | Uvicorn (standard)                     | ASGI server + `--reload` dev mode                         |
| Backend     | SQLAlchemy (ORM)                       | PostgreSQL object-relational mapping                      |
| Backend     | PostgreSQL                             | Persistent store for all exam data                        |
| Backend     | PyJWT / HMAC-SHA256                    | JWT-based authentication (12-hour expiry)                 |
| Frontend    | React 18.3 + TypeScript 5.5            | SPA                                                       |
| Frontend    | Vite 5.4                               | Dev server + bundler                                      |
| Frontend    | React Router DOM 6.26                  | Client-side routing                                       |
| WebRTC      | Native browser `RTCPeerConnection`     | STUN-only (`stun:stun.l.google.com:19302`)                |

## 4. Project Layout

```
yproctor/
├── README.md                 # User-facing documentation (run / configure / limitations)
├── generate-certs.sh         # Generates a self-signed cert for LAN HTTPS testing
├── certs/                    # Auto-generated cert.pem / key.pem (git-ignored)
├── backend/
│   ├── requirements.txt
│   └── app/
│       ├── main.py           # App assembly: CORS, routers, health-check + room-status REST
│       ├── __init__.py
│       ├── db.py             # PostgreSQL engine, SessionLocal, Base, get_db, init_db
│       ├── models.py         # ORM models: Candidate, Proctor, Admin, Exam,
│       │                      #   QuestionBank, ExamRegister, ExamAttempt, ExamResult
│       ├── schemas.py        # Pydantic schemas: LoginIn, ExamRegistrationOut, etc.
│       ├── api.py            # REST API: /exams, /exam-register, /candidates, /proctors
│       ├── auth.py           # JWT login, token verification, room-resolution logic
│       ├── services/
│       │   ├── room_service.py # RoomService singleton — in-memory WebRTC room/presence
│       │   └── __init__.py
│       └── websocket/
│           ├── manager.py      # ConnectionManager — live WebSocket bookkeeping
│           ├── signaling.py    # /ws/{room}/{role}/{id}?token=JWT — signalling relay logic
│           └── __init__.py
└── frontend/
    ├── index.html
    ├── package.json            # React 18, Vite, TypeScript, React Router
    ├── tsconfig.json
    ├── vite.config.ts          # Dev server: port 5173, HTTPS when certs present
    └── src/
        ├── main.tsx            # React 18 root + StrictMode + BrowserRouter
        ├── App.tsx             # Route definitions (/login, /candidate/*, /proctor/*)
        ├── types/index.ts      # Shared TS types (Identity, Role, MediaStatus, etc.)
        ├── services/
        │   ├── api.ts          # API_BASE URL resolution
        │   ├── auth.ts         # login(), fetchProfile(), fetchActiveRooms()
        │   ├── session.ts      # localStorage identity persistence & restoration
        │   ├── websocket.ts    # SignalingClient — WebSocket wrapper with JWT token
        │   ├── webrtc.ts       # CandidatePeerManager & ProctorPeerManager
        │   └── candidateSession.ts # singleton candidateSession — survives route nav
        ├── components/
        │   ├── MediaPanel.tsx, ConnectionStatus.tsx,
        │   ├── CandidateCard.tsx, PinnedCandidatePanel.tsx
        └── pages/
            ├── Login.tsx           # Role + email/password login, room selection (proctor)
            ├── Instructions.tsx     # Pre-exam: cam/mic/screen checks, consent
            ├── CandidateRoom.tsx    # Exam UI: questions + own connection status
            └── ProctorRoom.tsx      # Proctor dashboard: candidate grid + focused view
```


## 5. Data Model

All persistent data lives in PostgreSQL, accessed through SQLAlchemy ORM models defined in
`backend/app/models.py`. The schema is also declared in SQL in `backend/schema.sql`.

```
┌────────────────────────────────────────────── Entity Relationship ──────────────────────────────────────────────┐
│                                                                                                                   │
│  admins              exams                   candidates           question_bank         exam_register          │
│  ├─ id               ├─ id                  ├─ id                  ├─ id                 ├─ id                    │
│  ├─ username         ├─ name                ├─ first_name          ├─ exam_id (FK→exams)  ├─ exam_id (FK→exams)    │
│  ├─ password_hash    ├─ blueprint (JSONB)   ├─ last_name           ├─ question_text      ├─ candidate_id (FK)     │
│  ├─ email            ├─ duration_minutes    ├─ email               ├─ options (JSONB)    ├─ room_no              │
│  ├─ info (JSONB)     ├─ start_time           ├─ contact             ├─ correct_option     ├─ status (enum)        │
│  └─ created_at        ├─ end_time             ├─ info (JSONB)         ├─ marks              └─ created_at           │
│                      ├─ fees                ├─ created_at           ├─ question_type      exam_attempts            │
│                      └─ created_at          candidates/proctors/   ├─ subject             ├─ id                    │
│                                               admins are permanent   ├─ tag               ├─ exam_register_id (FK) │
│                                               question_bank is       └─ created_at        ├─ qp_json (JSONB)       │
│                                               permanent                                   ├─ answers (JSONB={})   │
│                                                                                           ├─ start_time (snapshot)│
│                                                                                           ├─ end_time (snapshot)  │
│                                                                                           ├─ started_at           │
│                                                                                           ├─ submitted_at         │
│                                                                                           ├─ score                │
│                                                                                           ├─ status (enum)        │
│                                                                                           └─ created_at           │
│                                                                                           exam_results              │
│                                                                                           ├─ id                    │
│                                                                                           ├─ exam_id              │
│                                                                                           ├─ candidate_id         │
│                                                                                           ├─ score                │
│                                                                                           ├─ total_marks          │
│                                                                                           ├─ percentage           │
│                                                                                           └─ published_at          │
│                                                                                                                       │
│  Relationships:                                                                                                       │
│  - Exam 1:N → QuestionBank        (question_bank.exam_id → exams.id)                                                 │
│  - Exam 1:N → ExamRegister        (exam_register.exam_id → exams.id)                                                   │
│  - ExamRegister 1:1 → ExamAttempt  (exam_attempts.exam_register_id → exam_register.id, UNIQUE)                          │
│  - Candidate 1:N → ExamRegister   (exam_register.candidate_id → candidates.id)                                        │
│  - ExamResult references (exam_id, candidate_id) — denormalized permanent archive                                     │
│                                                                                                                       │
│  Key JSONB fields:                                                                                                    │
│  - Exam.blueprint        → [{"count":10,"marks":2}, {"count":30,"marks":1}]                                            │
│  - QuestionBank.options  → ["a","b","c","d"] (array of option strings)                                                 │
│  - QuestionBank.correct_option → e.g. "b" (index or label)                                                            │
│  - ExamAttempt.qp_json   → [{id,text,options,correct_option,marks,question_type}, ...] (frozen question paper)         │
│  - ExamAttempt.answers   → {"question_id": "selected_option"} (candidate's answers)                                   │
└───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

**Lifecycle note:** `exam_attempts` is *disposable per-session state*. Once the result is
published to `exam_results` (a permanent, denormalized archive), the attempt row may be
discarded. The `qp_json` and the exam's `start_time`/`end_time` are **snapshotted** at attempt
creation so that an in-progress exam is unaffected if the exam definition or question bank
changes later.


## 6. Participant Roles & Topology

- **Admin** — Creates exams (with blueprints), populates the question bank, and manages
  candidate/proctor accounts. Interacts exclusively via REST endpoints.
- **Candidate** — A test-taker. Registers for an exam, logs in to receive a JWT and room
  assignment, then publishes three media tracks (camera video, microphone audio, screen-share)
  to each proctor via WebRTC. Each candidate opens *one* `RTCPeerConnection` **per proctor**
  in the room (a send-only publisher model).
- **Proctor** — An exam supervisor. Logs in, views their active rooms, joins a room, and
  *receives* the live camera + screen feeds of every candidate. Each proctor opens one
  `RTCPeerConnection` **per candidate** in the room and consumes the media.
- **Backend** — FastAPI + Uvicorn signalling server. Relays JSON control messages over
  WebSocket (JWT-authenticated), tracks in-room presence (in-memory), and persists exam data
  to PostgreSQL.

> **Why N×M connections?** A candidate never connects to other candidates; a proctor never
> connects to other proctors. The mesh is strictly candidate→proctor, so with *C* candidates
> and *P* proctors there are *C×P* peer connections — each media flow is direct
> browser-to-browser.

## 7. Signalling Message Protocol

All messages are plain JSON objects with a `type` field, exchanged over the WebSocket.
The WebSocket URL includes a JWT `?token=` query parameter that the backend validates to
confirm the participant's identity and role before accepting the connection.

```
/ws/{room_id}/{role}/{participant_id}?token=<JWT>

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

## 8. Exam Process Flow (Detailed)

### 8.1 Exam Setup (Admin)

1. Admin creates an **Exam** via `POST /api/exams` with a `blueprint` (e.g.
   `[{"count": 10, "marks": 2}, {"count": 30, "marks": 1}]`), a time window
   (`start_time` / `end_time`), `duration_minutes`, and `fees`.
2. Admin populates the **QuestionBank** — each question belongs to an exam and carries
   `question_text`, `options` (JSON array), `correct_option`, `marks`, `question_type`,
   `subject`, and `tag`.

### 8.2 Registration (Candidate → ExamRegister)

3. A candidate registers for the exam via `POST /api/exam-register`, supplying `exam_id`,
   `candidate_id`, and `room_no`. This creates an `exam_register` row with
   `status = "registered"`.

### 8.3 Login & Room Assignment (Candidate)

4. On candidate login (`POST /api/auth/candidate/login`), the backend queries the candidate's
   active registrations (status `registered` or `in_progress` with a `room_no`). It prefers
   a registration whose exam window is currently open; otherwise it falls back to the most
   recent one. The `room_no` is returned in the login response and stored in the candidate's
   identity.

### 8.4 WebRTC Proctoring Session (WebSocket Signaling)

5. The candidate connects to the WebSocket `/ws/{room_no}/candidate/{id}?token=JWT`. The
   backend validates the JWT (role + subject must match the URL) and the room:
   - The candidate is **rejected** if the room is full (6th candidate, code 4403).
   - The candidate is **rejected** if no proctor has started the room yet
     (`room-not-started`, code 4404) — a proctor must join first.
6. Once connected, the candidate performs a system check (camera, microphone, screen consent)
   on the Instructions page, then enters the exam Room page where WebRTC peer connections are
   established with each proctor.

### 8.5 Attempt Creation & Question-Paper Generation

7. When the candidate **starts the exam** (begins attending), an `exam_attempts` record is
   created for the candidate's `exam_register` entry. At this point:
   - **`qp_json`** is populated by selecting questions from the `question_bank` according to
     the exam's **blueprint**. For each blueprint entry `{"count": N, "marks": M}`:
     - Query `question_bank` filtered by `exam_id` and `marks = M`.
     - Randomly pick `N` questions from the matching set.
     - Serialize each as `{id, text, options, correct_option, marks, question_type}`.
   - The exam's `start_time` and `end_time` are **snapshotted** into the attempt's
     `start_time` and `end_time` so an in-progress attempt is unaffected if the exam definition
     changes later.
   - **`answers`** starts as `{}` (empty JSON object).
   - `started_at` is set to the current timestamp.
   - `status` = `"in_progress"`.

### 8.6 Answering & Submission

8. As the candidate answers each question, the `answers` JSONB is updated:
   `{ "question_id_1": "selected_option_a", "question_id_2": "selected_option_c", ... }`.
9. On **submit**, `submitted_at` is set, `status` becomes `"submitted"`, and `score` is
   computed by counting correct answers weighted by `marks`.

### 8.7 Result Archival

10. Once scoring is complete, the result is written to `exam_results` — a permanent,
    denormalized archive (`exam_id`, `candidate_id`, `score`, `total_marks`, `percentage`,
    `published_at`). The `exam_attempts` row (disposable per-session state) may then be
    discarded.


## 9. Key Design Decisions & Conventions

1. **Persistent exam data in PostgreSQL.** All exam entities (exams, question_bank,
   exam_register, exam_attempts, exam_results, candidates/proctors/admins) are persisted in
   PostgreSQL via SQLAlchemy ORM. Only WebRTC room *presence* is kept in-memory
   (`RoomService` / `ConnectionManager` singletons).
2. **JWT-based authentication.** Candidates and proctors authenticate with email/password and
   receive a JWT (HMAC-SHA256, 12-hour expiry). The token is sent both as a Bearer header for
   REST calls and as a `?token=` query parameter for the WebSocket.
3. **Blueprint-driven question-paper generation.** When an exam attempt starts, the question
   paper (`qp_json`) is generated by sampling from the `question_bank` according to the exam's
   `blueprint` (count + marks pairs). The paper is **frozen** (snapshot) so in-progress attempts
   are immune to later edits.
4. **STUN-only WebRTC.** No TURN server. Works out-of-the-box on the open internet or on
   `localhost`/same-LAN; connections behind symmetric NATs/firewalls may fail.
5. **Secure-context awareness.** `getDisplayMedia()` / `getUserMedia()` require `https://` or
   `http://localhost`. `generate-certs.sh` + `vite.config.ts` auto-enable HTTPS dev serving
   when certs are present, so the app works from a phone on the LAN.
6. **WebSocket base resolution.** The frontend derives `ws://` vs `wss://` from the page's own
   protocol — a page served over HTTPS can only open `wss://`, so the scheme is matched to
   avoid silent mixed-content blocking.
7. **Candidate session singleton.** The candidate side keeps a module-level `candidateSession`
   object so the WebSocket connection, media streams, and `RTCPeerConnection`s survive
   navigation from the Instructions page to the exam Room page (a fresh React tree, same tab).
8. **Connection-guarded onboarding.** `ensureConnected()` uses an in-flight promise
   (`connectPromise`) so React 18 StrictMode's double-invoke in dev (or fast route re-entry)
   cannot open a *second* WebSocket for the same candidate identity.
9. **Room capacity.** Fixed at 5 candidates, enforced at WebSocket connect time in the backend.
10. **Proctor-gated room entry.** A room must be *started* by a proctor (`room.active = True`)
    before candidates can join. When the last proctor leaves, the room is deactivated.

## 10. Limitations & Non-Goals (reiterated)

- **Plaintext passwords.** Candidate/proctor passwords are stored and compared as plaintext.
  This is a known, deliberate MVP gap — not a production practice.
- **No TURN server** — peer connectivity is best-effort depending on NAT topology.
- **No recording** of exam sessions or candidate media.
- **CORS** is wide-open (`allow_origins=["*"]`) — dev/POC only.
- The frontend's `CandidateRoom` currently renders **placeholder questions** (3 hardcoded).
  The real question paper comes from `ExamAttempt.qp_json` and will replace these placeholders.
- **`exam_attempts` lifecycle cleanup** (archival to `exam_results`, then row deletion) is
  designed but not yet wired into an endpoint.

---

*See `HLD.md` for the high-level design (component decomposition, data flows, protocols) and
`LLD1.md` for the low-level design (module-level details, key algorithms, and data models).*

