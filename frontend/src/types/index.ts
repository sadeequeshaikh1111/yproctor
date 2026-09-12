export type Role = 'candidate' | 'proctor'

export interface Identity {
  id: string
  role: Role
  room: string
  token: string
  email?: string
  firstName?: string
  lastName?: string
}

export type ConnState = 'pending' | 'connecting' | 'connected' | 'disconnected' | 'error'

export interface MediaStatus {
  camera: ConnState
  microphone: ConnState
  screen: ConnState
  webrtc: ConnState
}

export interface CandidateInfo {
  id: string
  mediaStatus: MediaStatus
}

export interface RoomStatus {
  room: string
  candidates: number
  proctors: number
  full: boolean
  active: boolean
  capacity: number
}

// ---- Signalling message shapes exchanged with the FastAPI WebSocket ----

export type SignalMessageType =
  | 'candidate-list'
  | 'candidate-joined'
  | 'candidate-left'
  | 'candidate-media-status'
  | 'media-status'
  | 'request-offer'
  | 'offer'
  | 'answer'
  | 'ice-candidate'
  | 'proctor-left'
  | 'room-full'
  | 'room-not-started'
  | 'ping'
  | 'pong'

export interface SignalMessage {
  type: SignalMessageType
  from?: string
  to?: string
  payload?: any
}

export const STORAGE_KEY = 'yproctor:identity'