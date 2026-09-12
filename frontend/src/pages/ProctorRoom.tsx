import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import CandidateCard from '../components/CandidateCard'
import PinnedCandidatePanel from '../components/PinnedCandidatePanel'
import MediaPanel from '../components/MediaPanel'
import ConnectionStatus from '../components/ConnectionStatus'
import { SignalingClient } from '../services/websocket'
import { ProctorPeerManager } from '../services/webrtc'
import type { RemoteCandidateStreams } from '../services/webrtc'
import { restoreIdentity, clearIdentity, saveIdentity } from '../services/session'
import { fetchActiveRooms } from '../services/auth'
import type { Identity, MediaStatus, ConnState } from '../types'

interface CandidateEntry {
  id: string
  mediaStatus: MediaStatus
  streams: RemoteCandidateStreams
}

interface RoomOption {
  room_no: string
  candidate_count: number
  exam_names: string[]
}

const EMPTY_STATUS: MediaStatus = { camera: 'pending', microphone: 'pending', screen: 'pending', webrtc: 'disconnected' }

const MAX_CANDIDATES = 5
const MAX_PINS = MAX_CANDIDATES

export default function ProctorRoom() {
  const navigate = useNavigate()
  const [identity, setIdentity] = useState<Identity | null>(null)
  const [candidates, setCandidates] = useState<Record<string, CandidateEntry>>({})
  const [focusId, setFocusId] = useState<string | null>(null)
  const [connectionError, setConnectionError] = useState('')
  const [pinnedIds, setPinnedIds] = useState<string[]>([])
  const [rooms, setRooms] = useState<RoomOption[]>([])
  const [switching, setSwitching] = useState(false)

  const signalingRef = useRef<SignalingClient | null>(null)
  const peerManagerRef = useRef<ProctorPeerManager | null>(null)

  const teardownConnection = () => {
    peerManagerRef.current?.closeAll()
    peerManagerRef.current = null
    signalingRef.current?.close()
    signalingRef.current = null
  }

  const connectToRoom = (ident: Identity) => {
    setCandidates({})
    setFocusId(null)
    setPinnedIds([])
    setConnectionError('')

    const signaling = new SignalingClient(ident)
    signalingRef.current = signaling

    const peerManager = new ProctorPeerManager(
      signaling,
      (candidateId, streams) => {
        setCandidates((prev) => ({
          ...prev,
          [candidateId]: {
            id: candidateId,
            mediaStatus: prev[candidateId]?.mediaStatus ?? EMPTY_STATUS,
            streams,
          },
        }))
      },
      (candidateId, state) => {
        const webrtc: ConnState =
          state === 'connected' ? 'connected'
          : state === 'connecting' || state === 'new' ? 'connecting'
          : state === 'failed' || state === 'disconnected' || state === 'closed' ? 'disconnected'
          : 'pending'
        setCandidates((prev) => {
          const existing = prev[candidateId]
          if (!existing) return prev
          return {
            ...prev,
            [candidateId]: { ...existing, mediaStatus: { ...existing.mediaStatus, webrtc } },
          }
        })
      },
    )
    peerManagerRef.current = peerManager

    signaling.onMessage((msg) => {
      switch (msg.type) {
        case 'candidate-list': {
          const list = (msg.payload ?? []) as { id: string; mediaStatus: MediaStatus }[]
          setCandidates((prev) => {
            const next = { ...prev }
            list.forEach((c) => {
              next[c.id] = { id: c.id, mediaStatus: c.mediaStatus, streams: prev[c.id]?.streams ?? {} }
            })
            return next
          })
          break
        }
        case 'candidate-joined': {
          const c = msg.payload as { id: string; mediaStatus: MediaStatus }
          setCandidates((prev) => ({
            ...prev,
            [c.id]: { id: c.id, mediaStatus: c.mediaStatus, streams: prev[c.id]?.streams ?? {} },
          }))
          break
        }
        case 'candidate-left': {
          const { id } = msg.payload as { id: string }
          peerManagerRef.current?.handleCandidateLeft(id)
          setCandidates((prev) => {
            const next = { ...prev }
            delete next[id]
            return next
          })
          setFocusId((f) => (f === id ? null : f))
          setPinnedIds((prev) => prev.filter((pid) => pid !== id))
          break
        }
        case 'candidate-media-status': {
          const { id, mediaStatus } = msg.payload as { id: string; mediaStatus: MediaStatus }
          setCandidates((prev) => {
            const existing = prev[id]
            if (!existing) return prev
            return { ...prev, [id]: { ...existing, mediaStatus: { ...existing.mediaStatus, ...mediaStatus } } }
          })
          break
        }
        case 'offer':
          if (msg.from) peerManagerRef.current?.handleOffer(msg.from, msg.payload)
          break
        case 'ice-candidate':
          if (msg.from) peerManagerRef.current?.handleIceCandidate(msg.from, msg.payload)
          break
      }
    })

    signaling.connect().catch(() => setConnectionError('Could not reach the signalling server.'))
  }

  useEffect(() => {
    let cancelled = false

    restoreIdentity('proctor').then((restored) => {
      if (cancelled) return

      if (!restored || !restored.room) {
        navigate('/login')
        return
      }

      setIdentity(restored)
      connectToRoom(restored)

      fetchActiveRooms(restored.token)
        .then((list) => {
          if (!cancelled) setRooms(list)
        })
        .catch(() => {
          // Non-fatal - the room switcher just won't have options beyond the current room.
        })
    })

    return () => {
      cancelled = true
      teardownConnection()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate])

  if (!identity) return null

  const handleLogout = () => {
    teardownConnection()
    clearIdentity()
    navigate('/login')
  }

  const handleRoomChange = (newRoom: string) => {
    if (!identity || newRoom === identity.room || switching) return
    setSwitching(true)
    teardownConnection()
    const newIdentity: Identity = { ...identity, room: newRoom }
    saveIdentity(newIdentity)
    setIdentity(newIdentity)
    connectToRoom(newIdentity)
    setSwitching(false)
  }

  const candidateList = Object.values(candidates)
  const focused = focusId ? candidates[focusId] : null
  const unpinnedList = candidateList.filter((c) => !pinnedIds.includes(c.id))

  // Make sure the currently connected room always appears as an option,
  // even if it fell out of the /api/proctor/rooms "active" list for some
  // reason (e.g. its last candidate just left).
  const roomOptions = rooms.some((r) => r.room_no === identity.room)
    ? rooms
    : [{ room_no: identity.room, candidate_count: candidateList.length, exam_names: [] }, ...rooms]

  const togglePin = (candidateId: string) => {
    setPinnedIds((prev) => {
      if (prev.includes(candidateId)) return prev.filter((id) => id !== candidateId)
      if (prev.length >= MAX_PINS) return prev
      return [...prev, candidateId]
    })
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f3f4f6', fontFamily: 'system-ui, sans-serif', padding: 24 }}>
      <div style={{ maxWidth: 1100, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h1 style={{ margin: 0 }}>YProctor Test Room</h1>
            <div style={{ color: '#6b7280', fontSize: 14 }}>
              {identity.firstName} {identity.lastName} · {identity.email} · ID: {identity.id} · {identity.role}
            </div>
            <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
              <label style={{ fontSize: 13, color: '#374151' }}>Room:</label>
              <select
                value={identity.room}
                onChange={(e) => handleRoomChange(e.target.value)}
                disabled={switching}
                style={roomSelectStyle}
              >
                {roomOptions.map((r) => (
                  <option key={r.room_no} value={r.room_no}>
                    {r.room_no} — {r.candidate_count} candidate{r.candidate_count === 1 ? '' : 's'}
                  </option>
                ))}
              </select>
              <span style={{ fontSize: 13, color: '#6b7280' }}>
                {candidateList.length}/{MAX_CANDIDATES} candidates
              </span>
            </div>
          </div>
          <button onClick={handleLogout} style={logoutButtonStyle}>Log out</button>
        </div>

        {connectionError && <div style={{ color: '#ef4444' }}>{connectionError}</div>}

        {pinnedIds.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <h2 style={{ margin: 0, fontSize: 15, color: '#374151' }}>
              Pinned ({pinnedIds.length}/{MAX_PINS})
            </h2>
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(pinnedIds.length, 2)}, 1fr)`, gap: 16 }}>
              {pinnedIds.map((id, i) => {
                const c = candidates[id]
                if (!c) return null
                return (
                  <PinnedCandidatePanel
                    key={id}
                    position={i + 1}
                    candidateId={id}
                    room={identity.room}
                    proctorId={identity.id}
                    streams={c.streams}
                    mediaStatus={c.mediaStatus}
                    onUnpin={() => togglePin(id)}
                  />
                )
              })}
            </div>
          </div>
        )}

        {focused ? (
          <div style={{ background: '#fff', borderRadius: 10, padding: 20, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h2 style={{ margin: 0 }}>Candidate: {focused.id}</h2>
              <button onClick={() => setFocusId(null)} style={closeButtonStyle}>Close</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, maxWidth: 900 }}>
              <MediaPanel stream={focused.streams.camera} label="WEBCAM" placeholder="Waiting for camera" muted={false} />
              <MediaPanel stream={focused.streams.screen} label="SCREEN" placeholder="Waiting for screen" />
            </div>
            <div style={{ display: 'flex', gap: 20, marginTop: 12 }}>
              <ConnectionStatus label="WebRTC" state={focused.mediaStatus.webrtc} />
              <ConnectionStatus label="Camera" state={focused.mediaStatus.camera} />
              <ConnectionStatus label="Mic" state={focused.mediaStatus.microphone} />
              <ConnectionStatus label="Screen" state={focused.mediaStatus.screen} />
            </div>
          </div>
        ) : unpinnedList.length === 0 && pinnedIds.length === 0 ? (
          <div style={{ color: '#6b7280', fontSize: 14 }}>Waiting for candidates to join...</div>
        ) : unpinnedList.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {pinnedIds.length > 0 && (
              <h2 style={{ margin: 0, fontSize: 15, color: '#374151' }}>All candidates</h2>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
              {unpinnedList.map((c) => (
                <CandidateCard
                  key={c.id}
                  candidateId={c.id}
                  room={identity.room}
                  proctorId={identity.id}
                  streams={c.streams}
                  mediaStatus={c.mediaStatus}
                  pinned={false}
                  pinDisabled={pinnedIds.length >= MAX_PINS}
                  onFocus={() => setFocusId(c.id)}
                  onTogglePin={() => togglePin(c.id)}
                />
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

const closeButtonStyle: React.CSSProperties = {
  padding: '6px 12px', borderRadius: 6, border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer',
}

const logoutButtonStyle: React.CSSProperties = {
  padding: '6px 12px', borderRadius: 6, border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer', fontSize: 13,
}

const roomSelectStyle: React.CSSProperties = {
  padding: '4px 8px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 13,
}