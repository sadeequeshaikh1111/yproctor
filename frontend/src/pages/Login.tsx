import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Identity, Role } from '../types'
import { login, fetchActiveRooms } from '../services/auth'
import { saveIdentity } from '../services/session'

interface RoomOption {
  room_no: string
  candidate_count: number
  exam_names: string[]
}

export default function Login() {
  const [role, setRole] = useState<Role>('candidate')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Proctor-only second step: pick which active room to supervise.
  const [pendingIdentity, setPendingIdentity] = useState<Omit<Identity, 'room'> | null>(null)
  const [rooms, setRooms] = useState<RoomOption[]>([])
  const [selectedRoom, setSelectedRoom] = useState('')

  const navigate = useNavigate()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!email.trim() || !password) {
      setError('Email and password are both required.')
      return
    }
    setSubmitting(true)
    try {
      const { token, profile } = await login(role, email.trim(), password)

      if (profile.role === 'candidate') {
        if (!profile.room) {
          setError('You are not currently assigned to a room. Contact your exam coordinator.')
          return
        }
        saveIdentity({
          id: String(profile.id), role: 'candidate', room: profile.room, token,
          email: profile.email, firstName: profile.firstName, lastName: profile.lastName,
        })
        navigate('/candidate/instructions')
        return
      }

      const activeRooms = await fetchActiveRooms(token)
      if (activeRooms.length === 0) {
        setError('No active rooms right now. Check back once candidates have been assigned.')
        return
      }
      setRooms(activeRooms)
      setSelectedRoom(activeRooms[0].room_no)
      setPendingIdentity({
        id: String(profile.id), role: 'proctor', token,
        email: profile.email, firstName: profile.firstName, lastName: profile.lastName,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed.')
    } finally {
      setSubmitting(false)
    }
  }

  const handleEnterRoom = (e: React.FormEvent) => {
    e.preventDefault()
    if (!pendingIdentity || !selectedRoom) return
    saveIdentity({ ...pendingIdentity, room: selectedRoom })
    navigate('/proctor/room')
  }

  if (pendingIdentity) {
    return (
      <div style={pageStyle}>
        <form onSubmit={handleEnterRoom} style={cardStyle}>
          <h1 style={{ margin: 0, fontSize: 22 }}>YProctor</h1>
          <p style={{ fontSize: 13, color: '#6b7280', margin: 0 }}>Choose a room to supervise</p>

          <select value={selectedRoom} onChange={(e) => setSelectedRoom(e.target.value)} style={inputStyle}>
            {rooms.map((r) => (
              <option key={r.room_no} value={r.room_no}>
                {r.room_no} — {r.candidate_count} candidate{r.candidate_count === 1 ? '' : 's'} ({r.exam_names.join(', ')})
              </option>
            ))}
          </select>

          {error && <div style={errorStyle}>{error}</div>}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button type="submit" style={buttonStyle}>Enter Room</button>
            <button
              type="button"
              onClick={() => { setPendingIdentity(null); setRooms([]); setError('') }}
              style={{ ...buttonStyle, background: '#fff', color: '#111827', border: '1px solid #d1d5db' }}
            >
              ← Change account / room
            </button>
          </div>
        </form>
      </div>
    )
  }

  return (
    <div style={pageStyle}>
      <form onSubmit={handleSubmit} style={cardStyle}>
        <h1 style={{ margin: 0, fontSize: 22 }}>YProctor</h1>

        <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
          <legend style={{ fontSize: 13, color: '#6b7280', marginBottom: 6 }}>Role</legend>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <input type="radio" name="role" value="candidate" checked={role === 'candidate'} onChange={() => setRole('candidate')} />
            Candidate
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="radio" name="role" value="proctor" checked={role === 'proctor'} onChange={() => setRole('proctor')} />
            Proctor
          </label>
        </fieldset>

        <label style={labelStyle}>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" style={inputStyle} autoComplete="username" />
        </label>

        <label style={labelStyle}>
          Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} style={inputStyle} autoComplete="current-password" />
        </label>

        {error && <div style={errorStyle}>{error}</div>}

        <button type="submit" disabled={submitting} style={{ ...buttonStyle, opacity: submitting ? 0.6 : 1 }}>
          {submitting ? 'Logging in…' : 'Log In'}
        </button>
      </form>
    </div>
  )
}

const pageStyle: React.CSSProperties = {
  minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: '#f3f4f6', fontFamily: 'system-ui, sans-serif',
}
const cardStyle: React.CSSProperties = {
  background: '#fff', padding: 32, borderRadius: 12, width: 340,
  boxShadow: '0 4px 20px rgba(0,0,0,0.08)', display: 'flex', flexDirection: 'column', gap: 16,
}
const labelStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, color: '#6b7280' }
const inputStyle: React.CSSProperties = { padding: '8px 10px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 14 }
const errorStyle: React.CSSProperties = { color: '#ef4444', fontSize: 13 }
const buttonStyle: React.CSSProperties = { padding: '10px 16px', borderRadius: 8, border: 'none', background: '#111827', color: '#fff', fontSize: 14, cursor: 'pointer' }