# YProctor — Low-Level Design (LLD)

This document details the internal design of each module in the YProctor codebase: data models,
class responsibilities, key algorithms, and the exact message-handling logic. For the
component-level view and data flows see `architecture.md` and `HLD.md`.

---

## 1. Backend Design (FastAPI + PostgreSQL)

The backend lives in `backend/app/` and consists of five cooperating areas:

| File                          | Responsibility                                                  |
|-------------------------------|-----------------------------------------------------------------|
| `app/main.py`                 | Application assembly: app factory, CORS, router inclusion, startup (init_db), health-check + room-status REST. |
| `app/db.py`                   | PostgreSQL engine, `SessionLocal`, `Base`, `get_db` dependency, `init_db()`. |
| `app/models.py`               | SQLAlchemy ORM models: Candidate, Proctor, Admin, QuestionBank, Exam, ExamRegister, ExamAttempt, ExamResult. |
| `app/schemas.py`              | Pydantic request/response schemas: LoginIn, PersonIn, ExamIn, RegisterIn, etc. |
| `app/api.py`                  | REST router (`/api/`): candidates, proctors, exams, exam-register, candidate exams, proctor rooms. Exam Engine logic. |
| `app/auth.py`                 | JWT auth: token creation/verification, login endpoints, current-user dependencies, room-resolution. |
| `app/services/room_service.py`| `RoomService`, `Room`, `Participant` — in-memory room & presence model. |
| `app/websocket/manager.py`     | `ConnectionManager` — tracks live WebSockets keyed by `(room, role, id)`. |
| `app/websocket/signaling.py`   | `signaling_endpoint()` — WebSocket route + all signalling relay logic (JWT-authenticated). |

`RoomService` and `ConnectionManager` expose **module-level singletons** (`room_service`,
`connection_manager`) instantiated at import time, so in-memory state is shared across
requests within the process. PostgreSQL state is accessed per-request via `get_db()`.

### 1.1 `app/main.py` — Application Assembly

```python
app = FastAPI(title="YProctor Signalling Server")
```

**Middleware:** `CORSMiddleware` with `allow_origins=["*"]` — wide open for the POC.

**Routing:**
- `app.include_router(signaling_router)` — WebSocket route (`/ws/...`).
- `app.include_router(api_router)` — REST API (`/api/...`).
- `app.include_router(auth_router)` — Auth (`/api/auth/...`).

**Startup:** `init_db()` creates any tables not already present (`CREATE TABLE IF NOT EXISTS`).

**REST endpoints:**

| Route                  | Method | Logic                                                                 |
|------------------------|--------|-----------------------------------------------------------------------|
| `GET /`                | GET    | Health check. Returns `{"status": "ok", "service": "yproctor-signalling"}`. |
| `GET /api/rooms/{room_id}` | GET | Calls `room_service.get_room(room_id)`. Returns candidate/proctor counts, `full` flag, `active` flag, capacity. No side effects. |

### 1.2 `app/db.py` — Database Connection

```python
DATABASE_URL = os.getenv(
    "DATABASE_URL", "postgresql+psycopg2://postgres:1234@localhost:5432/yproctor"
)
engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def init_db():
    from app import models  # registers models on Base
    Base.metadata.create_all(bind=engine)
```

- **`Base`** is the SQLAlchemy declarative base. All ORM models inherit from it.
- **`SessionLocal`** is a factory; each request gets its own `Session` via `Depends(get_db)`.
- **`init_db()`** is called at startup; it only creates tables that don't exist yet.

### 1.3 `app/models.py` — ORM Data Models

All models inherit from `Base` (SQLAlchemy declarative). Enums use `str` mixin for
JSON-serializable string values.

```python
# People
class Candidate(Base):      # table: candidates
class Proctor(Base):        # table: proctors
class Admin(Base):          # table: admins (password_hash, no plaintext)

# Exam definition
class QuestionBank(Base):   # table: question_bank
class Exam(Base):           # table: exams

# Registration & attempts
class ExamRegister(Base):   # table: exam_register
class ExamAttempt(Base):    # table: exam_attempts

# Permanent results archive
class ExamResult(Base):     # table: exam_results

# Pydantic response models (in same file)
class ProfileOut(BaseModel)
class LoginResponse(ProfileOut)
```

**`Exam` model:**

| Field              | Type    | Notes                                                   |
|--------------------|---------|---------------------------------------------------------|
| `id`               | Integer | PK                                                      |
| `name`             | String  | Not nullable                                            |
| `blueprint`        | JSONB   | `[{"count": 10, "marks": 2}, {"count": 30, "marks": 1}]`|
| `duration_minutes` | Integer | Exam duration                                           |
| `start_time`       | DateTime| Exam window opens                                       |
| `end_time`         | DateTime| Exam window closes                                      |
| `fees`             | Float   | Default 0                                               |
| `created_at`       | DateTime| Default `datetime.utcnow`                               |

**`QuestionBank` model:**

| Field            | Type   | Notes                                              |
|------------------|--------|----------------------------------------------------|
| `id`             | Integer| PK                                                 |
| `exam_id`        | Integer| FK → `exams.id`                                    |
| `question_text`  | String | Not nullable                                       |
| `options`        | JSONB  | `["a", "b", "c", "d"]`                             |
| `correct_option` | String | Not nullable                                       |
| `marks`          | Float  | Default 1                                          |
| `language`       | String | Default `"en"`                                     |
| `question_type` | String | `single_choice` / `multi_choice` / `true_false`     |
| `subject`        | String | Nullable                                           |
| `tag`            | String | Nullable                                           |
| `created_at`     | DateTime| Default `datetime.utcnow`                          |

**`ExamRegister` model:**

| Field           | Type    | Notes                                        |
|-----------------|---------|----------------------------------------------|
| `id`            | Integer | PK                                           |
| `exam_id`       | Integer | FK → `exams.id`                              |
| `candidate_id`  | Integer | FK → `candidates.id`                         |
| `room_no`       | String  | The WebRTC room for proctoring               |
| `status`        | Enum    | `registered` / `in_progress` / `completed` / `no_show` |
| `created_at`    | DateTime| Default `datetime.utcnow`                    |

**`ExamAttempt` model:**

| Field              | Type    | Notes                                              |
|--------------------|---------|----------------------------------------------------|
| `id`               | Integer | PK                                                 |
| `exam_register_id` | Integer | FK → `exam_register.id`, UNIQUE (1:1)              |
| `qp_json`          | JSONB   | Frozen question paper: `[{id, text, options, correct_option, marks, question_type}, ...]` |
| `answers`          | JSONB   | `{question_id: selected_option}`, default `{}`     |
| `start_time`       | DateTime| Snapshotted from `exams.start_time` at creation    |
| `end_time`         | DateTime| Snapshotted from `exams.end_time` at creation      |
| `started_at`       | DateTime| When candidate actually opened the paper           |
| `submitted_at`     | DateTime| When candidate submitted (nullable)                |
| `score`            | Float   | Computed at submission (nullable)                  |
| `status`           | Enum    | `in_progress` / `submitted`                       |
| `created_at`       | DateTime| Default `datetime.utcnow`                          |


### 1.4 `app/api.py` — REST API & Exam Engine

**Request body models (Pydantic):**

```python
class PersonIn(BaseModel):
    first_name: str
    last_name: str
    email: str
    password: str       # plaintext — known MVP gap
    contact: str | None = None
    info: dict = {}

class ExamIn(BaseModel):
    name: str
    blueprint: list[dict] = []        # [{"count": 10, "marks": 2}, ...]
    duration_minutes: int | None = None
    start_time: datetime | None = None
    end_time: datetime | None = None
    fees: float = 0

class RegisterIn(BaseModel):
    exam_id: int
    candidate_id: int
    room_no: str | None = None
```

**Endpoint table:**

| Method | Path                          | Logic                                                    |
|--------|-------------------------------|----------------------------------------------------------|
| POST   | `/api/candidates`             | Create Candidate (excludes password from response).        |
| GET    | `/api/candidates`             | List all candidates (no passwords).                      |
| GET    | `/api/candidates/{id}/exams`  | Join `exam_register` + `exams`; return `ExamRegistrationOut` rows. |
| POST   | `/api/proctors`               | Create Proctor (excludes password from response).        |
| GET    | `/api/proctors`               | List all proctors.                                       |
| GET    | `/api/proctor/rooms`          | Bearer auth. Join `exam_register` + `exams`; group by `room_no` where status ∈ (registered, in_progress). |
| POST   | `/api/exams`                  | Create Exam with blueprint.                              |
| GET    | `/api/exams`                  | List all exams (id, name, fees, blueprint).              |
| POST   | `/api/exam-register`          | Validate exam + candidate exist; create `ExamRegister` with status `registered`. |

**Exam Engine logic** (documented in `api.py` module docstring): The qpset file generation
logic was moved out of registration into exam attempts. Registering for an exam **only**
creates the `exam_register` row — it does not generate a question paper. The question paper
is generated when the exam attempt starts (see §2 — Exam Attempt Logic).

### 1.5 `app/auth.py` — JWT Authentication

**Configuration:**
- `JWT_SECRET` — from `JWT_SECRET_KEY` env var (default: `dev-insecure-secret-change-me`)
- `JWT_ALGORITHM` — `HS256`
- `JWT_EXPIRE_MINUTES` — from env (default: 720 = 12 hours)

**Token creation:**
```python
def create_access_token(user_id: int, role: str, email: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=JWT_EXPIRE_MINUTES)
    payload = {"sub": str(user_id), "role": role, "email": email, "exp": expire}
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)
```

**Token verification:**
- `decode_access_token(token)` — `jwt.decode` with error handling for `ExpiredSignatureError` (401)
  and `InvalidTokenError` (401).
- `get_current_payload(authorization)` — extracts Bearer token from `Authorization` header.
- `get_current_candidate(payload, db)` — checks `payload["role"] == "candidate"`, loads `Candidate`.
- `get_current_proctor(payload, db)` — checks `payload["role"] == "proctor"`, loads `Proctor`.

**Room resolution (`_candidate_current_room`):**
When a candidate logs in, the backend queries their active registrations (status in
`[registered, in_progress]`, `room_no` is not null), ordered by `id DESC`. It prefers a
registration whose exam window (`exam.start_time <= now <= exam.end_time`) is currently open;
otherwise it falls back to the most recent registration's `room_no`.

**Auth endpoints:**
- `POST /api/auth/candidate/login` — verifies email/password against DB, returns
  `LoginResponse` (access_token, profile with room assignment).
- `POST /api/auth/proctor/login` — verifies email/password, returns `LoginResponse` (room=None).
- `GET /api/auth/me` — Bearer token; returns `ProfileOut` for session restoration / room
  re-check.

**WebSocket auth (in `signaling.py`):**
The JWT is passed as a `?token=` query parameter. `decode_access_token` is called; if the
token's `role` or `sub` (as string) doesn't match the URL path, the connection is closed
with code 4401.


### 1.6 `app/services/room_service.py` — In-Memory Room State

`RoomService` tracks which candidates/proctors are present in which rooms. It is **purely
in-memory** (resets on backend restart) — exam data is in PostgreSQL, not here.

**Data model** (Python `dataclass`es):

```python
@dataclass
class Participant:
    id: str
    role: str                      # "candidate" | "proctor"
    room: str
    media_status: Dict[str, str]   # {camera, microphone, screen, webrtc}

@dataclass
class Room:
    room_id: str
    candidates: Dict[str, Participant] = field(default_factory=dict)
    proctors:   Dict[str, Participant] = field(default_factory=dict)
    active: bool = False            # True once a proctor has joined

    def is_full(self) -> bool:
        return len(self.candidates) >= MAX_CANDIDATES_PER_ROOM   # MAX = 5
```

- `Participant.media_status` defaults to all `"pending"` / `"disconnected"`.
- `Room.is_full()` counts candidates only — proctors don't count toward capacity.
- `Room.active` gates candidate entry: a room must be started by a proctor before candidates
  can join. When the last proctor disconnects, `stop_room_if_empty()` deactivates the room.

**`RoomService` class** (singleton `room_service`):

| Method | Side effects | Notes |
|--------|-------------|-------|
| `get_or_create_room(room_id)` | Creates `Room` if absent | Idempotent. |
| `get_room(room_id)` | None | Read-only; returns `Optional[Room]`. |
| `room_is_full(room_id)` | None | True if room exists & at capacity (candidates only). |
| `is_active(room_id)` | None | True only if a proctor has started the room. |
| `start_room(room_id)` | Sets `room.active = True` | Called when a proctor connects. |
| `stop_room_if_empty(room_id)` | Sets `room.active = False` (if no proctors left) | Prevents unattended room entry. |
| `add_candidate(room_id, candidate_id)` | Inserts participant | Returns the `Participant`. |
| `add_proctor(room_id, proctor_id)` | Inserts participant | Returns the `Participant`. |
| `remove_candidate(room_id, candidate_id)` | Deletes from dict | No-op if absent. |
| `remove_proctor(room_id, proctor_id)` | Deletes from dict | No-op if absent. |
| `update_media_status(room_id, candidate_id, status)` | Shallow merge | Only supplied keys change. |
| `list_candidates(room_id)` | None | Returns `{}` if room absent. |

### 1.7 `app/websocket/manager.py` — Connection Manager

`ConnectionManager` is a simple in-memory registry mapping a composite key to live `WebSocket`
objects. It performs **no message content inspection** — it only tracks presence and ships raw
JSON dicts.

**Key type:** `ConnectionKey = Tuple[str, str, str]` — `(room_id, role, participant_id)`

**State:** `self._connections: Dict[ConnectionKey, WebSocket] = {}`

**Methods:**

| Method | Behaviour |
|--------|-----------|
| `connect(ws, room_id, role, participant_id)` | **async.** Calls `ws.accept()` then stores the mapping. |
| `disconnect(room_id, role, participant_id)` | **sync.** `pop(..., None)` — safe even if never registered. |
| `get(room_id, role, participant_id)` | Returns `Optional[WebSocket]`. |
| `send_to(room_id, role, participant_id, message)` | **async.** Returns `False` if absent or send fails. |
| `broadcast_to_role(room_id, role, message)` | **async.** Sends to all matching connections; swallows per-client errors. |
| `proctor_ids_in_room(room_id)` | **sync.** Returns `list[str]` of proctor IDs — used to trigger offer creation. |

Send failures are silently swallowed so a dropped client never crashes the message loop.


### 1.8 `app/websocket/signaling.py` — Signalling Endpoint

**Route:** `GET /ws/{room_id}/{role}/{participant_id}?token=<JWT>` (registered via `@router.websocket`).

The handler is a single async coroutine per connection. It performs setup, enters a receive
loop, and cleans up in a `finally` block.

#### 1.8.1 Connection setup

1. **Role validation** — if `role` is not `"candidate"` or `"proctor"`, close with code `4400`
   (invalid role) and return *without* accepting.
2. **JWT validation** — extract `token` from query params; `decode_access_token(token)`.
   If the token is invalid/expired, close with code `4401`. If the token's `role` or `sub`
   (as string) doesn't match the URL path, close with code `4401`.
3. **Capacity check (candidates only)** — if `room_service.room_is_full(room_id)`, accept
   first, send `{"type": "room-full"}`, then close with code `4403`.
4. **Room-active check (candidates only)** — if `room_service.is_active(room_id)` is False
   (no proctor has started the room), accept, send `{"type": "room-not-started"}`, close
   with code `4404`.
5. **Register connection** — `connection_manager.connect(websocket, ...)` accepts and stores
   the socket.

#### 1.8.2 Presence announcement

- **Candidate join** (`role == "candidate"`):
  1. `room_service.add_candidate(room_id, participant_id)`.
  2. Broadcast `candidate-joined` (with `id` + default `mediaStatus` of all `"pending"` /
     `"disconnected"`) to all proctors in the room.
  3. For each proctor in `connection_manager.proctor_ids_in_room(room_id)`, send
     `request-offer` addressed `from` that proctor — tells the candidate to initiate an
     RTCPeerConnection toward that proctor.
- **Proctor join** (else branch):
  1. `room_service.add_proctor(room_id, participant_id)`.
  2. `room_service.start_room(room_id)` — activates the room.
  3. Send `candidate-list` (snapshot of all current candidates with media status) to this proctor.
  4. For each existing candidate, send `request-offer` addressed `from` this proctor.

#### 1.8.3 Message receive loop

```python
while True:
    message = await websocket.receive_json()
    msg_type = message.get("type")
    ...handle...
```

**Dispatch table:**

| `msg_type`       | Sender role | Action |
|------------------|-------------|--------|
| `offer`          | candidate   | `target_role = "proctor"`; relay `{type:"offer", from:id, payload}` to `message.to`. |
| `answer`         | proctor     | `target_role = "candidate"`; relay `{type:"answer", from:id, payload}` to `message.to`. |
| `ice-candidate`  | either      | Compute opposite role; relay to `message.to`. |
| `media-status`   | candidate   | `room_service.update_media_status(...)`; broadcast `{type:"candidate-media-status", payload:{id, mediaStatus}}` to proctors. |
| `ping`           | either      | Reply `{type:"pong"}`. |

**Direction inference rule:** `target_role = "proctor" if role == "candidate" else "candidate"`.

#### 1.8.4 Cleanup (`finally` block)

- `connection_manager.disconnect(...)` — remove WebSocket from registry.
- **Candidate departure:** `room_service.remove_candidate(...)`, broadcast `candidate-left`
  to all proctors.
- **Proctor departure:** `room_service.remove_proctor(...)`, call
  `room_service.stop_room_if_empty(room_id)` (deactivates room if no proctors remain), then
  for each candidate send `proctor-left` (so the candidate can tear down its RTCPeerConnection).
- Finally, if the socket isn't already `DISCONNECTED`, attempt `websocket.close()`.

Cleanup is **idempotent** in both `RoomService` and `ConnectionManager`, so it's safe even
if the client was already gone.


## 2. Exam Attempt Logic (Blueprint → Question Paper)

When a candidate **starts attending an exam** (exam login / attempt start), an
`exam_attempts` record is created. The key logic is the **question-paper generation**:
`qp_json` is populated by selecting questions from `question_bank` according to the exam's
`blueprint`.

### 2.1 Blueprint structure

The `blueprint` is a JSONB array on the `Exam` model, e.g.:

```json
[{"count": 10, "marks": 2}, {"count": 30, "marks": 1}]
```

Each entry specifies:
- `count` — how many questions to select
- `marks` — the mark value to filter questions by

### 2.2 Question-paper generation algorithm

```
1. Load the Exam and its blueprint.
2. For each blueprint entry {count: N, marks: M}:
   a. Query question_bank: WHERE exam_id = <exam.id> AND marks = M
   b. Randomly select N questions from the matching set (random.sample or equivalent)
   c. For each selected question, serialize:
      {id, text (question_text), options, correct_option, marks, question_type}
3. Concatenate all selected questions → this is qp_json (a JSON array of dicts).
4. Create the ExamAttempt row:
   - exam_register_id ← the candidate's registration
   - qp_json ← the generated question paper (frozen snapshot)
   - answers ← {} (empty JSON object)
   - start_time ← exam.start_time (snapshot)
   - end_time ← exam.end_time (snapshot)
   - started_at ← NOW() (when candidate actually opened the paper)
   - status ← "in_progress"
```

### 2.3 Key design properties

- **Frozen snapshot:** `qp_json` is written once at attempt creation and never recomputed. If
  the exam's blueprint or the question bank changes later, the in-progress attempt is
  unaffected — same reasoning as freezing the question set.
- **Time-window snapshot:** `start_time` and `end_time` are copied from the `Exam` at creation
  time, so an in-progress attempt is immune to later exam-window edits.
- **One attempt per registration:** `exam_attempts.exam_register_id` has a `UNIQUE` constraint,
  meaning a candidate can only have one active attempt per registration.
- **Disposable state:** Per the module docstring in `models.py`, `exam_attempts` is disposable
  per-session state — once the result is published to `exam_results` (permanent, denormalized),
  the attempt row may be discarded.

### 2.4 Answering & scoring

- As the candidate answers questions, the `answers` JSONB is updated:
  `{"question_id_1": "selected_option", "question_id_2": "selected_option", ...}`
- On **submit**, `submitted_at` is set, `status` → `"submitted"`, and `score` is computed
  by iterating over `qp_json`, checking each question's `correct_option` against the
  candidate's `answers`, weighted by `marks`.
- The result is archived to `exam_results` (`exam_id`, `candidate_id`, `score`,
  `total_marks`, `percentage`, `published_at`).


---

## 3. Frontend Design (React TypeScript SPA)

All frontend source lives under `frontend/src/`. The codebase uses no state-management library
(no Redux/Zustand); state is split between React component state and two module-level
singletons (`candidateSession` and `SignalingClient` instances).

### 3.1 `types/index.ts` — Shared Type Definitions

A single module re-exported by both services and components. Defines canonical types for
identity, connection states, media status, candidate info, room status, and the signalling
message envelope.

```typescript
export type Role = 'candidate' | 'proctor'

export interface Identity {
  id: string
  role: Role
  room: string
  token: string        // JWT bearer token from backend
  email?: string
  firstName?: string
  lastName?: string
}

export type ConnState = 'pending' | 'connecting' | 'connected' | 'disconnected' | 'error'

export interface MediaStatus {
  camera: ConnState
  microphone: ConnState
  screen: ConnState
  webrtc: ConnState
}

export interface CandidateInfo { id: string; mediaStatus: MediaStatus }

export interface RoomStatus {
  room: string
  candidates: number
  proctors: number
  full: boolean
  active: boolean
  capacity: number
}

export type SignalMessageType =
  | 'candidate-list' | 'candidate-joined' | 'candidate-left'
  | 'candidate-media-status' | 'media-status' | 'request-offer'
  | 'offer' | 'answer' | 'ice-candidate' | 'proctor-left'
  | 'room-full' | 'room-not-started' | 'ping' | 'pong'

export interface SignalMessage {
  type: SignalMessageType
  from?: string
  to?: string
  payload?: any
}

export const STORAGE_KEY = 'yproctor:identity'
```

**Design notes:**
- `SignalMessage` uses a discriminated-union-style `type` field but `payload` is typed `any`
  — a deliberate simplification so the backend can send an SDP blob or ICE init without a
  schema change.
- `Identity` now carries a `token` (JWT) that is sent as a `?token=` query parameter on the
  WebSocket URL and as an `Authorization: Bearer` header on REST calls.
- `RoomStatus` includes the `active` flag — a room is only active once a proctor has joined.


### 3.2 `services/websocket.ts` — SignalingClient

A thin wrapper around the browser `WebSocket` API. Used identically by both candidate and
proctor pages.

1. **Resolving the WebSocket URL.**
2. **Opening the connection with JWT.**
3. **Dispatching incoming JSON messages to subscribers.**
4. **Serialising outgoing messages.**
5. **Periodic keepalive pings.**

**URL resolution (`resolveWsBase()`):** Same as before — `VITE_WS_BASE` override or derived
from the page protocol (`wss:` if HTTPS, else `ws:`).

**Connection lifecycle:**
```typescript
connect(): Promise<void> {
  const { room, role, id, token } = this.identity
  const url = `${WS_BASE}/ws/${room}/${role}/${id}?token=${encodeURIComponent(token)}`
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url)
    this.ws = socket
    socket.onopen    = () => { startPing(); resolve() }
    socket.onmessage = (event) => { JSON.parse → notify listeners }
    socket.onerror   = () => reject(new Error('WebSocket connection failed'))
    socket.onclose   = () => clearInterval(pingTimer)
  })
}
```

- The JWT `token` from the `Identity` object is appended as a `?token=` query parameter.
- **Ping keepalive:** `setInterval` at **25 000 ms** sends `{type:"ping"}`; backend replies
  `{type:"pong"}`.
- **Listener model:** `onMessage(listener)` returns an unsubscribe function. Malformed JSON
  is silently dropped (try/catch).
- **Teardown:** `close()` clears the ping timer, calls `ws.close()`, nulls the reference,
  and clears all listeners.

### 3.3 `services/candidateSession.ts` — Candidate Session Singleton

A single module-level `candidateSession` object so that the WebSocket connection, media
streams, and `RTCPeerConnection`s survive navigating from the Instructions page to the exam
Room page (a fresh React component tree, same tab).

- **`ensureConnected(identity)`** — creates a `SignalingClient` with the candidate's identity
  (including JWT token), connects, and starts sending media status. Uses an in-flight promise
  (`connectPromise`) to guard against double-connects (React 18 StrictMode double-invoke).
- **`checkCamera()` / `checkScreen()`** — prompts for media permissions and updates
  `MediaStatus`.
- **`startWebRTC()`** — creates a `CandidatePeerManager` and establishes peer connections
  with each proctor (triggered by `request-offer` messages).
- **`roomNotStarted`** — set to `true` when the backend sends `room-not-started`, surfacing
  a distinct "waiting for proctor" UI state.

### 3.4 `services/webrtc.ts` — Peer Managers

- **`CandidatePeerManager`** — runs on the candidate's browser. Maintains one
  `RTCPeerConnection` per proctor. Publishes camera video, microphone audio, and screen-share
  tracks on each PC. Implements `handleRequestOffer`, `handleAnswer`, `handleIceCandidate`,
  `handleProctorLeft`.
- **`ProctorPeerManager`** — runs on the proctor's browser. Maintains one
  `RTCPeerConnection` per candidate. Consumes media tracks (recvonly). Implements
  `handleOffer`, `handleIceCandidate`, `handleCandidateLeft`.
- Both use STUN-only (`stun:stun.l.google.com:19302`) — no TURN server.

### 3.5 `services/auth.ts` & `services/session.ts` — Auth & Session

- **`auth.ts`**: `login(role, email, password)` — POSTs to `/api/auth/{role}/login`,
  returns `{token, profile}`. `fetchProfile(token)` — GETs `/api/auth/me` to restore session
  or re-check room assignment. `fetchActiveRooms(token)` — GETs `/api/proctor/rooms` (proctor
  only) to list active rooms with candidate counts.
- **`session.ts`**: `saveIdentity`/`clearIdentity`/`peekIdentity` manage the `STORAGE_KEY`
  in `localStorage`. `restoreIdentity(expectedRole)` validates the stored JWT against the
  backend and refreshes the candidate's room assignment if it changed.

### 3.6 Pages

| Page                  | Route                    | Responsibility                                                  |
|-----------------------|--------------------------|-----------------------------------------------------------------|
| `Login.tsx`           | `/login`                 | Role + email/password form. Proctors select from active rooms.  |
| `Instructions.tsx`    | `/candidate/instructions` | Pre-exam system check: camera/mic/screen, consent, WebRTC start. |
| `CandidateRoom.tsx`   | `/candidate/room`        | Exam UI: questions + own connection status. Currently placeholder questions; will be replaced by `qp_json` from attempt. |
| `ProctorRoom.tsx`     | `/proctor/room`          | Proctor dashboard: candidate grid, pinned panels, focused view, room switching. |

