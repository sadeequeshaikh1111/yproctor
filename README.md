# YProctor — WebRTC Proctoring POC

A minimal proof of concept showing that:

> Multiple candidates can enter assigned rooms, enable camera/microphone/screen
> sharing, establish direct WebRTC connections, and a proctor can see the
> candidates in that room.

This is **not** the production product — no database, no auth, no
recording, no persistence. Everything lives in memory and resets when the
backend restarts.

## Architecture

```
Candidate browser ──┐                      ┌── Proctor browser
                     │  WebSocket (JSON)    │
                     ├──────────────────────┤
                     │   FastAPI signalling  │
                     └──────────────────────┘
                     │                      │
                     └──── WebRTC media ────┘
                        (peer-to-peer, never
                         touches the backend)
```

FastAPI only handles:

- WebSocket signalling (`/ws/{room_id}/{role}/{participant_id}`)
- Room membership / candidate presence
- Relaying WebRTC offers, answers and ICE candidates

Each candidate opens one `RTCPeerConnection` per proctor watching the room
and publishes three tracks: camera video, microphone audio, and a screen
share video track. STUN-only (`stun:stun.l.google.com:19302`) — no TURN,
so this works best on networks that don't require relaying.

## Prerequisites

- Python 3.10+
- Node.js 18+

## Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

The server starts at `http://localhost:8000`. `GET /` is a health check,
`GET /api/rooms/{room_id}` reports how many candidates/proctors are
currently in a room.

## Frontend

```bash
cd frontend
npm install
npm run dev
```

The app starts at `http://localhost:5173`. By default the API (`/api`) and
the signalling WebSocket (`/ws`) are **proxied by the Vite dev server to the
backend on port `8000`** — so the browser only ever talks to one origin and
needs to trust a single certificate. Override the proxy backend with
`VITE_PROXY_TARGET` in `vite.config.ts`, point API calls elsewhere with
`VITE_API_BASE`, or point the WebSocket elsewhere with `VITE_WS_BASE`,
e.g.:

```bash
VITE_WS_BASE=ws://localhost:9000 npm run dev   # WebSocket to a different backend
```

## Testing over your LAN (e.g. proctor on a phone)

`getUserMedia()`/`getDisplayMedia()` only run in a browser **secure
context** — `https://` or `http://localhost` count, but `http://<lan-ip>`
does not. So to open the frontend from another device on your network,
the frontend (and, since a page loaded over https can only open `wss://`
connections, the backend too) need to serve TLS.

**1. Generate one shared self-signed certificate**, covering `localhost`
and your machine's LAN IP:

```bash
./generate-certs.sh 192.168.1.12   # replace with your `ifconfig`/`ip a` LAN IP
```

This writes `certs/cert.pem` and `certs/key.pem`.

**2. Start the backend with TLS:**

```bash
cd backend
source .venv/bin/activate
uvicorn app.main:app --host 0.0.0.0 --port 8000 \
  --ssl-keyfile ../certs/key.pem --ssl-certfile ../certs/cert.pem
```

**3. Start the frontend** — `vite.config.ts` automatically switches to
`https` once it finds `certs/cert.pem` + `certs/key.pem`, no flags needed:

```bash
cd frontend
npm run dev -- --host
```

It will print `https://192.168.1.12:5173/` as the Network URL.

**4. Open the frontend:** `https://192.168.1.12:5173/login` and accept its
self-signed certificate warning (**Advanced → Proceed**) once.

Because the dev server proxies `/api` and `/ws` to the backend, **that is
the only certificate warning you will ever see** — there's no need to open
`https://192.168.1.12:8000` separately (the old two-cert dance).

> If you hit the app with something that bypasses the proxy (e.g. `curl`,
> or a `VITE_API_BASE`/`VITE_WS_BASE` override), you still need to accept
> the backend certificate once at `https://192.168.1.12:8000/` first;
> certificate exceptions are per-origin, and an untrusted WebSocket origin
> fails silently with no prompt.

If you'd rather avoid the "not secure" warnings entirely, install
[mkcert](https://github.com/FiloSottile/mkcert) and use it in place of
`generate-certs.sh` — it creates a locally-trusted CA so both certs are
accepted with no browser warning.

## Trying it out

1. Open two (or more, up to 5) browser tabs/windows as candidates:
   `http://localhost:5173/login` → role **Candidate**, ID `C001`, Room
   `ROOM001`.
2. On the Instructions page, click **Check Camera** and **Check Screen**,
   grant the browser permission prompts, tick all three consent boxes,
   then click **Continue to Exam**.
3. Open another tab as the proctor: role **Proctor**, ID `P001`, room
   `ROOM001`. You should see each candidate's card with live webcam and
   screen previews plus connection status.
4. Click a candidate card to open the focused view.

Because WebRTC requires camera/mic/screen permissions, run this over
`https://` or `localhost` (both are treated as secure contexts by
browsers).

## Implementation notes

- The candidate side keeps a single module-level "session" object
  (`frontend/src/services/candidateSession.ts`) so the WebSocket and
  RTCPeerConnections survive navigating from the Instructions page to the
  exam Room page. Connecting is guarded with an in-flight promise so a
  second caller (e.g. React 18 StrictMode invoking an effect twice in
  dev) reuses the same connection attempt instead of opening a second
  WebSocket for the same candidate/room — two live connections for one
  candidate id would otherwise race on the backend, with whichever one
  closes first wrongly evicting the candidate's presence.

## Known POC limitations

- No authentication — anyone can log in as any ID/room.
- No database — room state is lost on backend restart.
- No TURN server — connections behind restrictive NATs/firewalls may fail.
- No recording, exam logic, or reporting.
- Room capacity (5 candidates) is enforced by the backend at WebSocket
  connect time.
