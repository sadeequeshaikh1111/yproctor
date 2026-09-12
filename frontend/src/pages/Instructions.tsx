import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import MediaPanel from '../components/MediaPanel'
import ConnectionStatus from '../components/ConnectionStatus'
import { candidateSession, useCandidateSession } from '../services/candidateSession'
import type { Identity } from '../types'
import { STORAGE_KEY } from '../types'

export default function Instructions() {
  const navigate = useNavigate()
  const session = useCandidateSession()
  const [consent, setConsent] = useState({ camera: false, microphone: false, screen: false })
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) {
      navigate('/login')
      return
    }
    const identity: Identity = JSON.parse(raw)
    if (identity.role !== 'candidate') {
      navigate('/login')
      return
    }
    candidateSession.ensureConnected(identity).catch(() => setLoadError('Could not reach the signalling server.'))
  }, [navigate])

  const allConsented = consent.camera && consent.microphone && consent.screen
  const allChecksPassed = session.readyToStart
  const canContinue = allConsented && allChecksPassed

  const handleContinue = () => {
    if (!canContinue) return
    session.startWebRTC()
    navigate('/candidate/room')
  }

  const handleRetry = () => {
    setLoadError('')
    candidateSession.retryConnect().catch(() => setLoadError('Could not reach the signalling server.'))
  }

  // Block the whole system-check flow until a proctor has started this
  // room - joining before then is what caused the proctor page to show
  // "could not reach the signalling server" / candidates never appearing.
  if (session.roomNotStarted) {
    return (
      <div style={{ minHeight: '100vh', background: '#f3f4f6', fontFamily: 'system-ui, sans-serif', padding: 24 }}>
        <div style={{ maxWidth: 560, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>
          <h1 style={{ margin: 0 }}>YProctor</h1>
          <section style={cardStyle}>
            <h2 style={sectionTitle}>Waiting for the proctor</h2>
            <p style={{ fontSize: 14, color: '#374151' }}>
              This room hasn't been started yet. Ask your proctor to log in first, then click retry below.
            </p>
            <button style={{ ...buttonStyle, width: 'auto' }} onClick={handleRetry}>
              Retry
            </button>
          </section>
        </div>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f3f4f6', fontFamily: 'system-ui, sans-serif', padding: 24 }}>
      <div style={{ maxWidth: 720, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 24 }}>
        <h1 style={{ margin: 0 }}>YProctor</h1>

        {loadError && <div style={{ color: '#ef4444' }}>{loadError}</div>}

        <section style={cardStyle}>
          <h2 style={sectionTitle}>System Check</h2>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div>
              <MediaPanel stream={session.cameraStream} label="CAMERA" mirrored placeholder="Camera not checked" />
              <button style={buttonStyle} onClick={() => session.checkCamera()}>Check Camera</button>
              <div style={{ marginTop: 6 }}>
                <ConnectionStatus label="Camera" state={session.status.camera} />
                <ConnectionStatus label="Microphone" state={session.status.microphone} />
              </div>
            </div>

            <div>
              <MediaPanel stream={session.screenStream} label="SCREEN" placeholder="Screen not checked" />
              <button style={buttonStyle} onClick={() => session.checkScreen()}>Check Screen</button>
              <div style={{ marginTop: 6 }}>
                <ConnectionStatus label="Screen" state={session.status.screen} />
              </div>
            </div>
          </div>

          <div style={{ marginTop: 12 }}>
            <ConnectionStatus label="WebRTC" state={session.status.webrtc} />
          </div>
        </section>

        <section style={cardStyle}>
          <h2 style={sectionTitle}>Consent</h2>
          <label style={checkboxRow}>
            <input
              type="checkbox"
              checked={consent.camera}
              onChange={(e) => setConsent((c) => ({ ...c, camera: e.target.checked }))}
            />
            I consent to camera capture.
          </label>
          <label style={checkboxRow}>
            <input
              type="checkbox"
              checked={consent.microphone}
              onChange={(e) => setConsent((c) => ({ ...c, microphone: e.target.checked }))}
            />
            I consent to microphone capture.
          </label>
          <label style={checkboxRow}>
            <input
              type="checkbox"
              checked={consent.screen}
              onChange={(e) => setConsent((c) => ({ ...c, screen: e.target.checked }))}
            />
            I consent to screen capture.
          </label>
        </section>

        {!allChecksPassed && (
          <div style={{ fontSize: 13, color: '#6b7280' }}>
            Complete the camera and screen checks above before continuing.
          </div>
        )}

        <button
          onClick={handleContinue}
          disabled={!canContinue}
          style={{
            ...buttonStyle,
            padding: '12px 20px',
            background: canContinue ? '#111827' : '#9ca3af',
            color: '#fff',
            cursor: canContinue ? 'pointer' : 'not-allowed',
            alignSelf: 'flex-start',
          }}
        >
          Continue to Exam
        </button>
      </div>
    </div>
  )
}

const cardStyle: React.CSSProperties = {
  background: '#fff', borderRadius: 10, padding: 20, boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
}

const sectionTitle: React.CSSProperties = { marginTop: 0, fontSize: 16 }

const buttonStyle: React.CSSProperties = {
  marginTop: 8, padding: '8px 14px', borderRadius: 6, border: '1px solid #d1d5db',
  background: '#fff', fontSize: 13, cursor: 'pointer', width: '100%',
}

const checkboxRow: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, marginBottom: 8,
}
