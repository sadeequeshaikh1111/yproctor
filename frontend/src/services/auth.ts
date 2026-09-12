import { API_BASE } from './api'
import type { Role } from '../types'

export interface AuthProfile {
  id: number
  firstName: string
  lastName: string
  email: string
  role: Role
  room: string | null
}

export interface LoginResult {
  token: string
  profile: AuthProfile
}

interface RoomOption {
  room_no: string
  candidate_count: number
  exam_names: string[]
}

function mapProfile(data: any): AuthProfile {
  return {
    id: data.id,
    firstName: data.first_name,
    lastName: data.last_name,
    email: data.email,
    role: data.role,
    room: data.room ?? null,
  }
}

export async function login(role: Role, email: string, password: string): Promise<LoginResult> {
  const res = await fetch(`${API_BASE}/api/auth/${role}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (!res.ok) {
    const detail = await res.json().catch(() => null)
    throw new Error(detail?.detail || 'Invalid email or password.')
  }
  const data = await res.json()
  return { token: data.access_token, profile: mapProfile(data) }
}

export async function fetchProfile(token: string): Promise<AuthProfile | null> {
  try {
    const res = await fetch(`${API_BASE}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return null
    return mapProfile(await res.json())
  } catch {
    return null
  }
}

export async function fetchActiveRooms(token: string): Promise<RoomOption[]> {
  const res = await fetch(`${API_BASE}/api/proctor/rooms`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error('Could not load active rooms.')
  return res.json()
}