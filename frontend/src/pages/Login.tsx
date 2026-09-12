import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Identity, Role } from '../types'
import { STORAGE_KEY } from '../types'

export default function Login() {
  const [role, setRole] = useState<Role>('candidate')
  const [id, setId] = useState('')
  const [room, setRoom] = useState('')
  const [error, setError] = useState('')
  const navigate = useNavigate()

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!id.trim() || !room.trim()) {
      setError('ID and Room are both required.')
      return
    }
    const identity: Identity = { id: id.trim(), role, room: room.trim() }
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(identity))

    if (role === 'candidate') {
      navigate('/candidate/instructions')
    } else {
      navigate('/proctor/room')
    }
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#f3f4f6', fontFamily: 'system-ui, sans-serif',
    }}>
      <form onSubmit={handleSubmit} style={{
        background: '#fff', padding: 32, borderRadius: 12, width: 340,
        boxShadow: '0 4px 20px rgba(0,0,0,0.08)', display: 'flex', flexDirection: 'column', gap: 16,
      }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>YProctor</h1>

        <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
          <legend style={{ fontSize: 13, color: '#6b7280', marginBottom: 6 }}>Role</legend>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <input
              type="radio"
              name="role"
              value="candidate"
              checked={role === 'candidate'}
              onChange={() => setRole('candidate')}
            />
            Candidate
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="radio"
              name="role"
              value="proctor"
              checked={role === 'proctor'}
              onChange={() => setRole('proctor')}
            />
            Proctor
          </label>
        </fieldset>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, color: '#6b7280' }}>
          {role === 'candidate' ? 'Candidate ID' : 'Proctor ID'}
          <input
            value={id}
            onChange={(e) => setId(e.target.value)}
            placeholder={role === 'candidate' ? 'C001' : 'P001'}
            style={inputStyle}
          />
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13, color: '#6b7280' }}>
          Room
          <input
            value={room}
            onChange={(e) => setRoom(e.target.value)}
            placeholder="ROOM001"
            style={inputStyle}
          />
        </label>

        {error && <div style={{ color: '#ef4444', fontSize: 13 }}>{error}</div>}

        <button type="submit" style={{
          padding: '10px 16px', borderRadius: 8, border: 'none', background: '#111827',
          color: '#fff', fontSize: 14, cursor: 'pointer',
        }}>
          Enter
        </button>
      </form>
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  padding: '8px 10px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 14,
}
