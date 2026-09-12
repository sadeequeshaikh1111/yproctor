import { useState } from 'react'
import MediaPanel from './MediaPanel'
import ConnectionStatus from './ConnectionStatus'
import { useAudioLevel } from '../hooks/useAudioLevel'
import type { MediaStatus } from '../types'
import type { RemoteCandidateStreams } from '../services/webrtc'

interface PinnedCandidatePanelProps {
  position: number // 1-based pin slot number, shown as a badge
  candidateId: string
  room: string
  proctorId: string
  streams: RemoteCandidateStreams
  mediaStatus: MediaStatus
  onUnpin: () => void
}

export default function PinnedCandidatePanel({
  position,
  candidateId,
  room,
  proctorId,
  streams,
  mediaStatus,
  onUnpin,
}: PinnedCandidatePanelProps) {
  const speaking = useAudioLevel(streams.camera)
  const [muted, setMuted] = useState(false)

  const openInNewTab = () => {
    const url = `/proctor/focus?room=${encodeURIComponent(room)}&proctor=${encodeURIComponent(proctorId)}&candidate=${encodeURIComponent(candidateId)}`
    window.open(url, '_blank', 'noopener')
  }

  return (
    <div
      style={{
        position: 'relative',
        border: speaking ? '2px solid #22c55e' : '1px solid #e5e7eb',
        boxShadow: speaking ? '0 0 0 3px rgba(34,197,94,0.25)' : undefined,
        borderRadius: 10,
        padding: 12,
        background: '#fff',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        transition: 'border-color 120ms ease, box-shadow 120ms ease',
      }}
    >
      <span
        style={{
          position: 'absolute', top: -10, left: -10, width: 24, height: 24, borderRadius: '50%',
          background: '#111827', color: '#fff', fontSize: 12, fontWeight: 700,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        {position}
      </span>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <strong>
          {candidateId}
          {speaking && (
            <span style={{ marginLeft: 6, fontSize: 11, color: '#22c55e', fontWeight: 600 }}>
              ● Speaking
            </span>
          )}
        </strong>
        <button onClick={onUnpin} style={unpinButtonStyle}>Unpin</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <MediaPanel stream={streams.camera} label="WEBCAM" placeholder="Waiting for camera" muted={muted} />
        <MediaPanel stream={streams.screen} label="SCREEN" placeholder="Waiting for screen" />
      </div>

      <div style={{ display: 'flex', gap: 6 }}>
        <button onClick={openInNewTab} style={smallButtonStyle}>Open in new tab</button>
        <button onClick={() => setMuted((m) => !m)} style={smallButtonStyle}>
          {muted ? 'Unmute' : 'Mute'}
        </button>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, columnGap: 14 }}>
        <ConnectionStatus label="WebRTC" state={mediaStatus.webrtc} />
        <ConnectionStatus label="Camera" state={mediaStatus.camera} />
        <ConnectionStatus label="Mic" state={mediaStatus.microphone} />
        <ConnectionStatus label="Screen" state={mediaStatus.screen} />
      </div>
    </div>
  )
}

const smallButtonStyle: React.CSSProperties = {
  flex: 1, padding: '4px 8px', fontSize: 12, borderRadius: 6, border: '1px solid #d1d5db',
  background: '#f9fafb', cursor: 'pointer',
}

const unpinButtonStyle: React.CSSProperties = {
  padding: '2px 8px', fontSize: 11, borderRadius: 6, border: '1px solid #d1d5db',
  background: '#fff', cursor: 'pointer',
}
