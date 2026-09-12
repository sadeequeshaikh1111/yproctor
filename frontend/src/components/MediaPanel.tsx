import { useEffect, useRef } from 'react'

interface MediaPanelProps {
  stream?: MediaStream | null
  label: string
  muted?: boolean
  mirrored?: boolean
  placeholder?: string
}

export default function MediaPanel({ stream, label, muted = true, mirrored = false, placeholder }: MediaPanelProps) {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = stream ?? null
    }
  }, [stream])

  return (
    <div style={{ position: 'relative', background: '#111827', borderRadius: 8, overflow: 'hidden', aspectRatio: '16 / 9' }}>
      {stream ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={muted}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            transform: mirrored ? 'scaleX(-1)' : undefined,
          }}
        />
      ) : (
        <div style={{
          width: '100%', height: '100%', display: 'flex', alignItems: 'center',
          justifyContent: 'center', color: '#6b7280', fontSize: 12,
        }}>
          {placeholder ?? 'No signal'}
        </div>
      )}
      <span style={{
        position: 'absolute', top: 6, left: 8, fontSize: 11, color: '#e5e7eb',
        background: 'rgba(0,0,0,0.5)', padding: '2px 6px', borderRadius: 4,
      }}>
        {label}
      </span>
    </div>
  )
}
