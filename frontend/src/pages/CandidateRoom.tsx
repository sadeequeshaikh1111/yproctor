import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import ConnectionStatus from '../components/ConnectionStatus'
import { candidateSession, useCandidateSession } from '../services/candidateSession'
import { restoreIdentity, clearIdentity } from '../services/session'
import type { Identity } from '../types'

const QUESTIONS = [
  { q: 'What is 2 + 2?', options: ['3', '4', '5', '6'] },
  { q: 'What is 5 + 3?', options: ['6', '7', '8', '9'] },
  { q: 'What is 9 - 4?', options: ['3', '4', '5', '6'] },
]

export default function CandidateRoom() {
  const navigate = useNavigate()
  const session = useCandidateSession()
  const [identity, setIdentity] = useState<Identity | null>(null)
  const [questionIndex, setQuestionIndex] = useState(0)
  const [selected, setSelected] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    restoreIdentity('candidate').then((restored) => {
      if (cancelled) return

      if (!restored || !restored.room) {
        navigate('/login')
        return
      }

      setIdentity(restored)

      // Safety net: if the candidate landed here directly without finishing
      // the Instructions flow, send them back.
      if (!candidateSession.cameraStream || !candidateSession.screenStream) {
        navigate('/candidate/instructions')
      } else {
        candidateSession.startWebRTC()
      }
    })

    return () => {
      cancelled = true
    }
  }, [navigate])

  if (!identity) return null

  const current = QUESTIONS[questionIndex % QUESTIONS.length]

  const handleNext = () => {
    setSelected(null)
    setQuestionIndex((i) => i + 1)
  }

  const handleLogout = () => {
    clearIdentity()
    navigate('/login')
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f3f4f6', fontFamily: 'system-ui, sans-serif', padding: 24 }}>
      <div style={{ maxWidth: 560, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h1 style={{ margin: 0 }}>YProctor</h1>
            <div style={{ color: '#6b7280', fontSize: 14 }}>Room: {identity.room}</div>
          </div>
          <button onClick={handleLogout} style={logoutButtonStyle}>Log out</button>
        </div>

        <div style={{ background: '#fff', borderRadius: 10, padding: 20, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
          <h2 style={{ marginTop: 0, fontSize: 16 }}>Question {questionIndex + 1}</h2>
          <p style={{ fontSize: 15 }}>{current.q}</p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {current.options.map((opt) => (
              <label key={opt} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
                <input
                  type="radio"
                  name="answer"
                  checked={selected === opt}
                  onChange={() => setSelected(opt)}
                />
                {opt}
              </label>
            ))}
          </div>

          <button
            onClick={handleNext}
            style={{
              marginTop: 16, padding: '8px 16px', borderRadius: 6, border: 'none',
              background: '#111827', color: '#fff', cursor: 'pointer', fontSize: 14,
            }}
          >
            Next
          </button>
        </div>

        <div style={{ background: '#fff', borderRadius: 10, padding: 16, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <ConnectionStatus label="WebRTC" state={session.status.webrtc} />
          <ConnectionStatus label="Camera" state={session.status.camera} />
          <ConnectionStatus label="Microphone" state={session.status.microphone} />
          <ConnectionStatus label="Screen" state={session.status.screen} />
        </div>
      </div>
    </div>
  )
}

const logoutButtonStyle: React.CSSProperties = {
  padding: '6px 12px', borderRadius: 6, border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer', fontSize: 13,
}