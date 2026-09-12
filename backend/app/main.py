from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.websocket.signaling import router as signaling_router
from app.services.room_service import room_service, MAX_CANDIDATES_PER_ROOM

app = FastAPI(title="YProctor Signalling Server")

# Wide-open CORS for the POC - this is not for production use.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(signaling_router)


@app.get("/")
async def root():
    return {"status": "ok", "service": "yproctor-signalling"}


@app.get("/api/rooms/{room_id}")
async def room_status(room_id: str):
    room = room_service.get_room(room_id)
    if room is None:
        return {
            "room": room_id,
            "candidates": 0,
            "proctors": 0,
            "full": False,
            "active": False,
            "capacity": MAX_CANDIDATES_PER_ROOM,
        }
    return {
        "room": room_id,
        "candidates": len(room.candidates),
        "proctors": len(room.proctors),
        "full": room.is_full(),
        "active": room.active,
        "capacity": MAX_CANDIDATES_PER_ROOM,
    }
    