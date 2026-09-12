"""
Tracks live WebSocket connections and provides helpers to send/broadcast
signalling messages. Pure in-memory bookkeeping, no persistence.
"""
from __future__ import annotations

from typing import Dict, Optional, Tuple

from fastapi import WebSocket

# key: (room_id, role, participant_id) -> websocket
ConnectionKey = Tuple[str, str, str]


class ConnectionManager:
    def __init__(self) -> None:
        self._connections: Dict[ConnectionKey, WebSocket] = {}

    async def connect(self, websocket: WebSocket, room_id: str, role: str, participant_id: str) -> None:
        await websocket.accept()
        self._connections[(room_id, role, participant_id)] = websocket

    def disconnect(self, room_id: str, role: str, participant_id: str) -> None:
        self._connections.pop((room_id, role, participant_id), None)

    def get(self, room_id: str, role: str, participant_id: str) -> Optional[WebSocket]:
        return self._connections.get((room_id, role, participant_id))

    async def send_to(self, room_id: str, role: str, participant_id: str, message: dict) -> bool:
        ws = self.get(room_id, role, participant_id)
        if ws is None:
            return False
        try:
            await ws.send_json(message)
            return True
        except Exception:
            return False

    async def broadcast_to_role(self, room_id: str, role: str, message: dict) -> None:
        targets = [
            ws for (r, ro, _pid), ws in self._connections.items()
            if r == room_id and ro == role
        ]
        for ws in targets:
            try:
                await ws.send_json(message)
            except Exception:
                pass

    def proctor_ids_in_room(self, room_id: str) -> list[str]:
        return [
            pid for (r, ro, pid) in self._connections.keys()
            if r == room_id and ro == "proctor"
        ]


connection_manager = ConnectionManager()
