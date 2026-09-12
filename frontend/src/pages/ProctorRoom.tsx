import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import CandidateCard from '../components/CandidateCard'
import MediaPanel from '../components/MediaPanel'
import ConnectionStatus from '../components/ConnectionStatus'
import { SignalingClient } from '../services/websocket'
import { ProctorPeerManager } from '../services/webrtc'
import type { RemoteCandidateStreams } from '../services/webrtc'
import type { Identity, MediaStatus, ConnState } from '../types'
import { STORAGE_KEY } from '../types'

interface CandidateEntry {
  id: string
  mediaStatus: MediaStatus
  streams: RemoteCandidateStreams
}

const EMPTY_STATUS: MediaStatus = { camera: 'pending', microphone: 'pending', screen: 'pending', webrtc: 'disconnected' }

const MAX_CANDIDATES = 5

export default function ProctorRoom() {
  const navigate = useNavigate()
  const [identity, setIdentity] = useState<Identity | null>(null)
  const [candidates, setCandidates] = useState<Record<string, CandidateEntry>>({})
  const [focusId, setFocusId] = useState<string | null>(null)
  const [connectionError, setConnectionError] = useState('')

  const signalingRef = useRef<SignalingClient | null>(null)
  const peerManagerRef = useRef<ProctorPeerManager | null>(null)

  useEffect(() => {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) {
      navigate('/login')
      return
    }
    const parsed: Identity = JSON.parse(raw)
    if (parsed.role !== 'proctor') {
      navigate('/login')
      return
    }
    setIdentity(parsed)

    const signaling = new SignalingClient(parsed)
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

    return () => {
      peerManagerRef.current?.closeAll()
      signalingRef.current?.close()
    }
  }, [navigate])

  if (!identity) return null

  const candidateList = Object.values(candidates)
  const focused = focusId ? candidates[focusId] : null

  return (
    <div style={{ minHeight: '100vh', background: '#f3f4f6', fontFamily: 'system-ui, sans-serif', padding: 24 }}>
      <div style={{ maxWidth: 1100, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div>
          <h1 style={{ margin: 0 }}>YProctor Test Room</h1>
          <div style={{ color: '#6b7280', fontSize: 14 }}>
            Room: {identity.room} · {candidateList.length}/{MAX_CANDIDATES} candidates
          </div>
        </div>

        {connectionError && <div style={{ color: '#ef4444' }}>{connectionError}</div>}

        {focused ? (
          <div style={{ background: '#fff', borderRadius: 10, padding: 20, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h2 style={{ margin: 0 }}>Candidate: {focused.id}</h2>
              <button onClick={() => setFocusId(null)} style={closeButtonStyle}>Close</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, maxWidth: 900 }}>
              <MediaPanel stream={focused.streams.camera} label="WEBCAM" placeholder="Waiting for camera" />
              <MediaPanel stream={focused.streams.screen} label="SCREEN" placeholder="Waiting for screen" />
            </div>
            <div style={{ display: 'flex', gap: 20, marginTop: 12 }}>
              <ConnectionStatus label="WebRTC" state={focused.mediaStatus.webrtc} />
              <ConnectionStatus label="Camera" state={focused.mediaStatus.camera} />
              <ConnectionStatus label="Mic" state={focused.mediaStatus.microphone} />
              <ConnectionStatus label="Screen" state={focused.mediaStatus.screen} />
            </div>
          </div>
        ) : candidateList.length === 0 ? (
          <div style={{ color: '#6b7280', fontSize: 14 }}>Waiting for candidates to join...</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
            {candidateList.map((c) => (
              <CandidateCard
                key={c.id}
                candidateId={c.id}
                room={identity.room}
                streams={c.streams}
                mediaStatus={c.mediaStatus}
                onFocus={() => setFocusId(c.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

const closeButtonStyle: React.CSSProperties = {
  padding: '6px 12px', borderRadius: 6, border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer',
}
