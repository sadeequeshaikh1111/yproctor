"""
In-memory room state for the YProctor POC.

No database is used. Everything lives in process memory and is reset
whenever the backend restarts. This is intentional for a proof of concept.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, Optional

MAX_CANDIDATES_PER_ROOM = 5


@dataclass
class Participant:
    id: str
    role: str  # "candidate" | "proctor"
    room: str
    media_status: Dict[str, str] = field(default_factory=lambda: {
        "camera": "pending",
        "microphone": "pending",
        "screen": "pending",
        "webrtc": "disconnected",
    })


@dataclass
class Room:
    room_id: str
    candidates: Dict[str, Participant] = field(default_factory=dict)
    proctors: Dict[str, Participant] = field(default_factory=dict)

    def is_full(self) -> bool:
        return len(self.candidates) >= MAX_CANDIDATES_PER_ROOM


class RoomService:
    """Tracks which candidates/proctors are present in which rooms."""

    def __init__(self) -> None:
        self._rooms: Dict[str, Room] = {}

    def get_or_create_room(self, room_id: str) -> Room:
        if room_id not in self._rooms:
            self._rooms[room_id] = Room(room_id=room_id)
        return self._rooms[room_id]

    def get_room(self, room_id: str) -> Optional[Room]:
        return self._rooms.get(room_id)

    def room_is_full(self, room_id: str) -> bool:
        room = self._rooms.get(room_id)
        return bool(room and room.is_full())

    def add_candidate(self, room_id: str, candidate_id: str) -> Participant:
        room = self.get_or_create_room(room_id)
        participant = Participant(id=candidate_id, role="candidate", room=room_id)
        room.candidates[candidate_id] = participant
        return participant

    def add_proctor(self, room_id: str, proctor_id: str) -> Participant:
        room = self.get_or_create_room(room_id)
        participant = Participant(id=proctor_id, role="proctor", room=room_id)
        room.proctors[proctor_id] = participant
        return participant

    def remove_candidate(self, room_id: str, candidate_id: str) -> None:
        room = self._rooms.get(room_id)
        if room and candidate_id in room.candidates:
            del room.candidates[candidate_id]

    def remove_proctor(self, room_id: str, proctor_id: str) -> None:
        room = self._rooms.get(room_id)
        if room and proctor_id in room.proctors:
            del room.proctors[proctor_id]

    def update_media_status(self, room_id: str, candidate_id: str, status: Dict[str, str]) -> None:
        room = self._rooms.get(room_id)
        if room and candidate_id in room.candidates:
            room.candidates[candidate_id].media_status.update(status)

    def list_candidates(self, room_id: str) -> Dict[str, Participant]:
        room = self._rooms.get(room_id)
        return room.candidates if room else {}


room_service = RoomService()
