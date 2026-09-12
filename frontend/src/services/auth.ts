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

/**
 * Friendly message when the browser cannot reach the backend at all.
 * By default the app talks to the same origin and the Vite dev server
 * proxies /api to the backend on :8000 (see vite.config.ts).
 */
function networkErrorHint(): string {
  const target = API_BASE || window.location.origin
  return (
    `Cannot reach the backend at ${target}/api. ` +
    'Make sure it is running (uvicorn on port 8000), then reload this page.'
  )
}

/** Read the backend's JSON `detail` (FastAPI error body) if present. */
async function backendDetail(res: Response): Promise<string | null> {
  const contentType = res.headers.get('content-type') || ''
  if (!contentType.includes('application/json')) return null
  try {
    const body = await res.json()
    return typeof body?.detail === 'string' ? body.detail : null
  } catch {
    return null
  }
}

function httpErrorMessage(status: number, detail: string | null, fallback: string): string {
  if (detail) return detail
  // A non-JSON 5xx almost always means the dev-server proxy could not reach
  // the backend (connection refused / TLS mismatch), not a credential issue.
  if (status >= 500) return 'The backend is not responding correctly. Make sure it is running, then reload this page.'
  return fallback
}

export async function login(role: Role, email: string, password: string): Promise<LoginResult> {
  let res: Response
  try {
    res = await fetch(`${API_BASE}/api/auth/${role}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
  } catch {
    throw new Error(networkErrorHint())
  }

  if (!res.ok) {
    const detail = await backendDetail(res)
    const message = httpErrorMessage(
      res.status,
      detail,
      `Invalid email or password (HTTP ${res.status}).`,
    )
    throw new Error(
      role === 'proctor'
        ? `${message} — if you are a proctor, make sure the "Proctor" role is selected above.`
        : message,
    )
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
  let res: Response
  try {
    res = await fetch(`${API_BASE}/api/proctor/rooms`, {
      headers: { Authorization: `Bearer ${token}` },
    })
  } catch {
    throw new Error(networkErrorHint())
  }
  if (!res.ok) {
    const detail = await backendDetail(res)
    throw new Error(httpErrorMessage(res.status, detail, `Could not load active rooms (HTTP ${res.status}).`))
  }
  return res.json()
}