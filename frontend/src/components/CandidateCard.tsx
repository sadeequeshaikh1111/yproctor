import MediaPanel from './MediaPanel'
import ConnectionStatus from './ConnectionStatus'
import type { MediaStatus } from '../types'
import type { RemoteCandidateStreams } from '../services/webrtc'

interface CandidateCardProps {
  candidateId: string
  room: string
  streams: RemoteCandidateStreams
  mediaStatus: MediaStatus
  onFocus: () => void
}

export default function CandidateCard({ candidateId, room, streams, mediaStatus, onFocus }: CandidateCardProps) {
  return (
    <div
      onClick={onFocus}
      style={{
        border: '1px solid #e5e7eb',
        borderRadius: 10,
        padding: 10,
        background: '#fff',
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <strong>{candidateId}</strong>
        <span style={{ fontSize: 12, color: '#6b7280' }}>{room}</span>
      </div>

      <MediaPanel stream={streams.camera} label="WEBCAM" placeholder="Waiting for camera" />
      <MediaPanel stream={streams.screen} label="SCREEN" placeholder="Waiting for screen" />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <ConnectionStatus label="WebRTC" state={mediaStatus.webrtc} />
        <ConnectionStatus label="Camera" state={mediaStatus.camera} />
        <ConnectionStatus label="Mic" state={mediaStatus.microphone} />
        <ConnectionStatus label="Screen" state={mediaStatus.screen} />
      </div>
    </div>
  )
}
