"""
Signalling WebSocket endpoint.

Route: /ws/{room_id}/{role}/{participant_id}
role is either "candidate" or "proctor".

This module only exchanges JSON messages (presence, offers, answers, ICE
candidates). It never touches media itself - actual audio/video/screen
flows browser-to-browser over WebRTC.
"""
from __future__ import annotations

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from starlette.websockets import WebSocketState

from app.services.room_service import room_service
from app.websocket.manager import connection_manager

router = APIRouter()


def _candidate_snapshot(room_id: str) -> list[dict]:
    return [
        {"id": c.id, "mediaStatus": c.media_status}
        for c in room_service.list_candidates(room_id).values()
    ]


@router.websocket("/ws/{room_id}/{role}/{participant_id}")
async def signaling_endpoint(websocket: WebSocket, room_id: str, role: str, participant_id: str):
    if role not in ("candidate", "proctor"):
        await websocket.close(code=4400)
        return

    if role == "candidate" and room_service.room_is_full(room_id):
        await websocket.accept()
        await websocket.send_json({"type": "room-full"})
        await websocket.close(code=4403)
        return

    # Candidates may only join a room a proctor has already started.
    if role == "candidate" and not room_service.is_active(room_id):
        await websocket.accept()
        await websocket.send_json({"type": "room-not-started"})
        await websocket.close(code=4404)
        return

    await connection_manager.connect(websocket, room_id, role, participant_id)

    if role == "candidate":
        room_service.add_candidate(room_id, participant_id)

        # Tell every proctor already in the room that a new candidate appeared.
        await connection_manager.broadcast_to_role(room_id, "proctor", {
            "type": "candidate-joined",
            "payload": {"id": participant_id, "mediaStatus": {
                "camera": "pending", "microphone": "pending",
                "screen": "pending", "webrtc": "disconnected",
            }},
        })

        # Ask the candidate to create an offer for each proctor already watching.
        for proctor_id in connection_manager.proctor_ids_in_room(room_id):
            await connection_manager.send_to(room_id, "candidate", participant_id, {
                "type": "request-offer",
                "from": proctor_id,
            })

    else:  # proctor
        room_service.add_proctor(room_id, participant_id)
        room_service.start_room(room_id)

        # Send the newly connected proctor the current candidate list.
        await websocket.send_json({
            "type": "candidate-list",
            "payload": _candidate_snapshot(room_id),
        })

        # Ask every existing candidate to create an offer addressed to this proctor.
        for candidate_id in room_service.list_candidates(room_id).keys():
            await connection_manager.send_to(room_id, "candidate", candidate_id, {
                "type": "request-offer",
                "from": participant_id,
            })

    try:
        while True:
            message = await websocket.receive_json()
            msg_type = message.get("type")

            if msg_type in ("offer", "answer", "ice-candidate"):
                target_role = "proctor" if role == "candidate" else "candidate"
                to_id = message.get("to")
                if to_id:
                    await connection_manager.send_to(room_id, target_role, to_id, {
                        "type": msg_type,
                        "from": participant_id,
                        "payload": message.get("payload"),
                    })

            elif msg_type == "media-status" and role == "candidate":
                status = message.get("payload", {})
                room_service.update_media_status(room_id, participant_id, status)
                await connection_manager.broadcast_to_role(room_id, "proctor", {
                    "type": "candidate-media-status",
                    "payload": {"id": participant_id, "mediaStatus": status},
                })

            elif msg_type == "ping":
                await websocket.send_json({"type": "pong"})

    except WebSocketDisconnect:
        pass
    finally:
        connection_manager.disconnect(room_id, role, participant_id)
        if role == "candidate":
            room_service.remove_candidate(room_id, participant_id)
            await connection_manager.broadcast_to_role(room_id, "proctor", {
                "type": "candidate-left",
                "payload": {"id": participant_id},
            })
        else:
            room_service.remove_proctor(room_id, participant_id)
            room_service.stop_room_if_empty(room_id)
            # Let candidates know this proctor's peer connection is gone.
            for candidate_id in room_service.list_candidates(room_id).keys():
                await connection_manager.send_to(room_id, "candidate", candidate_id, {
                    "type": "proctor-left",
                    "payload": {"id": participant_id},
                })
        if websocket.client_state != WebSocketState.DISCONNECTED:
            try:
                await websocket.close()
            except Exception:
                pass
            