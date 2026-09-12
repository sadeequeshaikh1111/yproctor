import type { Identity, Role } from '../types'
import { STORAGE_KEY } from '../types'
import { fetchProfile } from './auth'

export function saveIdentity(identity: Identity): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(identity))
}

export function clearIdentity(): void {
  localStorage.removeItem(STORAGE_KEY)
}

export function peekIdentity(): Identity | null {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as Identity
  } catch {
    return null
  }
}

/**
 * Validates the stored session against the backend (catches an expired
 * or tampered token) and refreshes fields that can change between logins
 * - notably a candidate's assigned room. Clears storage and returns null
 * if there's no valid session for the expected role.
 */
export async function restoreIdentity(expectedRole: Role): Promise<Identity | null> {
  const stored = peekIdentity()
  if (!stored || !stored.token) return null

  const profile = await fetchProfile(stored.token)
  if (!profile || profile.role !== expectedRole) {
    clearIdentity()
    return null
  }

  const identity: Identity = {
    id: String(profile.id),
    role: profile.role,
    room: profile.role === 'candidate' ? profile.room ?? '' : stored.room,
    token: stored.token,
    email: profile.email,
    firstName: profile.firstName,
    lastName: profile.lastName,
  }
  saveIdentity(identity)
  return identity
}