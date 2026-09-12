# YProctor — Low-Level Design (LLD)

This document details the internal design of each module in the YProctor codebase: data models,
class responsibilities, key algorithms, and the exact message-handling logic. For the
component-level view and data flows see `architecture.md` and `HLD.md`.

---

## 1. Backend Design (FastAPI Signalling Server)

The backend lives in `backend/app/` and consists of three cooperating areas:

| File                          | Responsibility                                                  |
|-------------------------------|-----------------------------------------------------------------|
| `app/main.py`                 | Application assembly: app factory, middleware, router inclusion, REST endpoints. |
| `app/services/room_service.py`| `RoomService`, `Room`, `Participant` — in-memory room & presence data model. |
| `app/websocket/manager.py`     | `ConnectionManager` — tracks live WebSockets keyed by `(room, role, id)`. |
| `app/websocket/signaling.py`   | `signaling_endpoint()` — the WebSocket route handler and all signalling relay logic. |

All three service/manager modules expose **module-level singletons** (`room_service`,
`connection_manager`) instantiated at import time, so state is shared across requests within
the process.

### 1.1 `app/main.py` — Application Assembly

**App factory pattern** (inline at module level):

```python
app = FastAPI(title="YProctor Signalling Server")
```

**Middleware:**
- `CORSMiddleware` with `allow_origins=["*"]` — wide open because the POC expects to be served
  from a different origin (the Vite dev server on port 5173). **Not production-safe.**

**Routing:**
- `app.include_router(signaling_router)` — mounts the WebSocket route from
  `app.websocket.signaling`.

**REST endpoints:**

| Route                  | Method | Logic                                                                 |
|------------------------|--------|-----------------------------------------------------------------------|
| `GET /`                | GET    | Health check. Returns `{"status": "ok", "service": "yproctor-signalling"}`. No DB hit. |
| `GET /api/rooms/{room_id}` | GET  | Calls `room_service.get_room(room_id)`. If the room doesn't exist or is empty, returns zero counts and `full: False`. If it exists, returns real candidate/proctor counts, `full` flag, and capacity. No side effects. |

### 1.2 `app/services/room_service.py` — In-Memory Room State

**Data model** (Python `dataclass`es, no ORM):

```python
@dataclass
class Participant:
    id: str                         # participant_id from the URL
    role: str                       # "candidate" | "proctor"
    room: str                       # room_id
    media_status: Dict[str, str]   # {camera, microphone, screen, webrtc}

@dataclass
class Room:
    room_id: str
    candidates: Dict[str, Participant] = field(default_factory=dict)
    proctors:   Dict[str, Participant] = field(default_factory=dict)

    def is_full(self) -> bool:
        return len(self.candidates) >= MAX_CANDIDATES_PER_ROOM   # MAX = 5
```

- `Participant.media_status` defaults to all `"pending"` / `"disconnected"` and is updated
  incrementally via `update_media_status()` (a shallow `.update()` merge — only supplied keys change).
- `Room.is_full()` is evaluated **only for candidates** — proctors do not count toward capacity.

**`RoomService` class** — a thin facade over `self._rooms: Dict[str, Room]`:

| Method | Side effects | Notes |
|--------|-------------|-------|
| `get_or_create_room(room_id)` | Creates `Room` if absent | Idempotent; used by `add_candidate`/`add_proctor`. |
| `get_room(room_id)` | None | Read-only lookup; returns `Optional[Room]`. |
| `room_is_full(room_id)` | None | Returns `True` only if the room exists *and* is at capacity. |
| `add_candidate(room_id, candidate_id)` | Inserts participant | Returns the `Participant`. |
| `add_proctor(room_id, proctor_id)` | Inserts participant | Returns the `Participant`. |
| `remove_candidate(room_id, candidate_id)` | Deletes from dict | No-op if room/candidate absent. |
| `remove_proctor(room_id, proctor_id)` | Deletes from dict | No-op if room/proctor absent. |
| `update_media_status(room_id, candidate_id, status)` | Mutates `Participant.media_status` | Shallow merge. |
| `list_candidates(room_id)` | None | Returns `{}` if room absent (caller iterates safely). |

The **singleton** `room_service = RoomService()` is created at module load and imported by both
`main.py` (REST) and `signaling.py` (WebSocket handler).

### 1.3 `app/websocket/manager.py` — Connection Manager

`ConnectionManager` is a simple in-memory registry mapping a composite key to live `WebSocket`
objects. It performs **no message content inspection** — it only tracks presence and ships raw
JSON dicts.

**Key type:**
```python
ConnectionKey = Tuple[str, str, str]   # (room_id, role, participant_id)
```

**State:**
```python
self._connections: Dict[ConnectionKey, WebSocket] = {}
```

**Methods:**

| Method | Behaviour |
|--------|-----------|
| `connect(ws, room_id, role, participant_id)` | **async.** Calls `ws.accept()` then stores the mapping. The accept happens *before* business logic in `signaling.py` so the client knows the connection was received. |
| `disconnect(room_id, role, participant_id)` | **sync.** `pop(..., None)` — safe even if the key was never registered. |
| `get(room_id, role, participant_id)` | Returns `Optional[WebSocket]`. |
| `send_to(room_id, role, participant_id, message)` | **async.** Looks up the target; returns `False` if absent or if the send raised (swallowed). Returns `True` on success. |
| `broadcast_to_role(room_id, role, message)` | **async.** Sends to *all* connections matching `(room_id, role)`. Swallows per-client send errors so one dead socket doesn't abort the broadcast. |
| `proctor_ids_in_room(room_id)` | **sync.** Returns `list[str]` of proctor participant IDs currently connected — used to trigger offer creation. |

**Error handling philosophy:** send failures are silently swallowed (`except Exception: pass` or
`return False`) so that a dropped client never crashes or stalls the message loop for others.

### 1.4 `app/websocket/signaling.py` — Signalling Endpoint

**Route:** `GET /ws/{room_id}/{role}/{participant_id}` (registered via `@router.websocket`).

The handler is a single async coroutine per connection. It performs setup, enters a receive
loop, and cleans up in a `finally` block.

#### 1.4.1 Connection setup (pre-accept checks)

1. **Role validation** — if `role` is not `"candidate"` or `"proctor"`, close with code `4400`
   (invalid role) and return *without* accepting.
2. **Capacity check (candidates only)** — if `role == "candidate"` and
   `room_service.room_is_full(room_id)`, the handler **accepts first**, sends a `{"type":
   "room-full"}` JSON message, then closes with code `4403`. The accept-then-close pattern ensures
   the browser receives the error message rather than a raw socket close.
3. **Register connection** — `connection_manager.connect(websocket, ...)` accepts and stores
   the socket.

#### 1.4.2 Presence announcement (per role)

- **Candidate join** (`role == "candidate"`):
  1. `room_service.add_candidate(room_id, participant_id)`.
  2. Broadcast `candidate-joined` (with `id` + default `mediaStatus` of all `"pending"` /
     `"disconnected"`) to all proctors in the room.
  3. For each proctor already present (`connection_manager.proctor_ids_in_room(room_id)`),
     send a `request-offer` message addressed `from` that proctor — this tells the candidate
     to initiate an RTCPeerConnection toward that proctor.
- **Proctor join** (else branch):
  1. `room_service.add_proctor(room_id, participant_id)`.
  2. Send `candidate-list` (a snapshot of all current candidates with their media status) to
     *this* proctor.
  3. For each existing candidate, send `request-offer` addressed `from` this proctor — this
     tells the candidate to create an offer toward the new proctor.

#### 1.4.3 Message receive loop

```python
while True:
    message = await websocket.receive_json()
    msg_type = message.get("type")
    ...handle...
```

**Dispatch table:**

| `msg_type`       | Sender role | Action |
|------------------|-------------|--------|
| `offer`          | candidate   | Compute `target_role = "proctor"`; look up `message.to`; relay `{type:"offer", from:id, payload:offer_sdp}` to that proctor. |
| `answer`         | proctor     | Compute `target_role = "candidate"`; relay `{type:"answer", from:id, payload:answer_sdp}` to that candidate. |
| `ice-candidate`  | either      | Compute opposite role; relay `{type:"ice-candidate", from:id, payload:candidate}` to `message.to`. |
| `media-status`   | candidate   | Update `room_service.update_media_status(...)`, then broadcast `{type:"candidate-media-status", payload:{id, mediaStatus}}` to all proctors. |
| `ping`           | either      | Reply `{type:"pong"}`. |

**Direction inference rule:** `target_role = "proctor" if role == "candidate" else "candidate"`.
This works because media is always candidate→proctor (candidate sends offers/ICE, proctor sends
answers/ICE).

#### 1.4.4 Cleanup (`finally` block)

- `connection_manager.disconnect(...)` — remove the WebSocket from the registry.
- **Candidate departure:** `room_service.remove_candidate(...)`, broadcast `candidate-left`
  to all proctors.
- **Proctor departure:** `room_service.remove_proctor(...)`, then for each candidate in the
  room send `proctor-left` (so the candidate can tear down its RTCPeerConnection to this proctor).
- Finally, if the socket isn't already `DISCONNECTED`, attempt `websocket.close()` (guarding
  against a double-close exception).

This cleanup is **idempotent** in both `RoomService` and `ConnectionManager` (they use `pop(...,
None)` / `del ... if present` patterns), so it's safe even if the client was already gone.

---

## 2. Frontend Design (React TypeScript SPA)

All frontend source lives under `frontend/src/`. The codebase uses no state-management library
(no Redux/Zustand); state is split between React component state and two module-level
singletons (`candidateSession`, described below).

### 2.1 `types/index.ts` — Shared Type Definitions

A single module re-exported by both services and components. Defines the canonical types for
identity, connection states, media status, candidate info, and the signalling message envelope.

```typescript
export type Role = 'candidate' | 'proctor'

export interface Identity { id: string; role: Role; room: string }

export type ConnState = 'pending' | 'connecting' | 'connected' | 'disconnected' | 'error'

export interface MediaStatus {
  camera: ConnState
  microphone: ConnState
  screen: ConnState
  webrtc: ConnState
}

export interface CandidateInfo { id: string; mediaStatus: MediaStatus }

export type SignalMessageType =
  | 'candidate-list' | 'candidate-joined' | 'candidate-left'
  | 'candidate-media-status' | 'media-status' | 'request-offer'
  | 'offer' | 'answer' | 'ice-candidate' | 'proctor-left'
  | 'room-full' | 'ping' | 'pong'

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
  (no per-type payload typing) — this is a deliberate POC simplification so the backend can send
  an SDP blob (`RTCSessionDescriptionInit`) or an ICE init without a schema change.
- `ConnState` is shared between frontend UI status and the backend's `media_status` string
  values (they use the same literal strings: `"pending"`, `"connected"`, etc.).
- `STORAGE_KEY` is a single constant — the identity stored in `sessionStorage` by `Login` and
  read back by every downstream page.

### 2.2 `services/websocket.ts` — SignalingClient

A thin wrapper around the browser `WebSocket` API. It is role-agnostic (used identically by both
candidate and proctor pages) and concerns itself only with:

1. **Resolving the WebSocket URL.**
2. **Opening the connection and resolving/rejecting a connect promise.**
3. **Dispatching incoming JSON messages to subscribers.**
4. **Serialising outgoing messages.**
5. **Periodic keepalive pings.**

**URL resolution (`resolveWsBase()`):**
- If `VITE_WS_BASE` env var is set → use it verbatim (full override).
- Otherwise, derive from the *current page's* location: scheme `wss:` if the page is HTTPS (the
  page protocol), else `ws:`, same hostname, and port from `VITE_WS_PORT` (default `8000`).
- This matters because a page loaded over HTTPS cannot open a plain `ws://` — it would be
  blocked as mixed content. Matching the scheme prevents this silent failure.

**Connection lifecycle:**

```typescript
connect(): Promise<void> {
  const url = `${WS_BASE}/ws/${room}/${role}/${id}`
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

**Ping keepalive:** a `setInterval` at **25 000 ms** sends `{"type":"ping"}`. The backend replies
with `{"type":"pong"}`. This keeps the connection alive through idle proxies/NATs and gives the
candidate a chance to detect a dead socket via the `onclose` path.

**Listener model:** `onMessage(listener)` returns an unsubscribe function. Multiple listeners
can register (e.g. the candidate session and a page-level effect both subscribe). Messages are
parsed inside a `try/catch` — malformed JSON is silently dropped (no crash, no rejection).

**Teardown:** `close()` clears the ping timer, calls `ws.close()`, nulls the reference, and clears
all listeners.


