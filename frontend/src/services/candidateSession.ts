import { useEffect, useState } from 'react'
import { SignalingClient } from './websocket'
import { CandidatePeerManager, getCameraAndMic, getScreenShare } from './webrtc'
import type { Identity, MediaStatus, SignalMessage } from '../types'

type Listener = () => void

/**
 * A single module-level session object so that the WebSocket connection,
 * media streams and RTCPeerConnections survive navigating from the
 * Instructions page to the exam Room page (a fresh React component tree,
 * same browser tab).
 */
class CandidateSession {
  identity: Identity | null = null
  signaling: SignalingClient | null = null
  peerManager: CandidatePeerManager | null = null
  cameraStream: MediaStream | null = null
  screenStream: MediaStream | null = null
  status: MediaStatus = { camera: 'pending', microphone: 'pending', screen: 'pending', webrtc: 'disconnected' }
  // True if the backend rejected us because no proctor has started the
  // room yet. Distinct from a generic connect failure so the UI can show
  // a specific "waiting for proctor" message instead of a hard error.
  roomNotStarted = false

  private pendingOfferRequests = new Set<string>()
  private listeners = new Set<Listener>()
  // Tracks an in-flight connection attempt. Without this, two callers that
  // both see `this.signaling === null` (e.g. React 18 StrictMode invoking
  // the Instructions page's effect twice in dev, or a fast route re-entry)
  // would each create their own SignalingClient and open a second
  // WebSocket for the same candidate/room before the first one finishes
  // connecting - the backend then holds two live connections for one
  // candidate id, and whichever one closes first wrongly evicts the
  // candidate's presence out from under the other. Setting this
  // synchronously, before any `await`, closes that race.
  private connectPromise: Promise<void> | null = null

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private emit() {
    this.listeners.forEach((fn) => fn())
  }

  ensureConnected(identity: Identity): Promise<void> {
    if (this.signaling) return Promise.resolve()
    if (this.connectPromise) return this.connectPromise

    this.identity = identity
    this.roomNotStarted = false
    this.connectPromise = (async () => {
      const client = new SignalingClient(identity)
      client.onMessage((msg) => this.handleMessage(msg))
      await client.connect()
      this.signaling = client
      this.sendStatus()
    })().finally(() => {
      this.connectPromise = null
    })

    return this.connectPromise
  }

  /** Re-attempt connecting after a room-not-started rejection. */
  retryConnect(): Promise<void> {
    if (!this.identity) return Promise.resolve()
    this.roomNotStarted = false
    this.emit()
    return this.ensureConnected(this.identity)
  }

  private handleMessage(msg: SignalMessage) {
    switch (msg.type) {
      case 'request-offer':
        if (msg.from) {
          if (this.peerManager) {
            this.peerManager.handleRequestOffer(msg.from)
          } else {
            this.pendingOfferRequests.add(msg.from)
          }
        }
        break
      case 'answer':
        if (msg.from) this.peerManager?.handleAnswer(msg.from, msg.payload)
        break
      case 'ice-candidate':
        if (msg.from) this.peerManager?.handleIceCandidate(msg.from, msg.payload)
        break
      case 'proctor-left':
        if (msg.payload?.id) this.peerManager?.handleProctorLeft(msg.payload.id)
        break
      case 'room-full':
        this.status = { ...this.status, webrtc: 'error' }
        this.emit()
        break
      case 'room-not-started':
        // The backend accepts-then-closes the socket for this case, so
        // clear our reference to it and surface a distinct UI state
        // rather than the generic "could not reach server" error.
        this.signaling = null
        this.roomNotStarted = true
        this.emit()
        break
    }
  }

  async checkCamera(): Promise<void> {
    this.status = { ...this.status, camera: 'connecting', microphone: 'connecting' }
    this.emit()
    try {
      this.cameraStream = await getCameraAndMic()
      this.status = { ...this.status, camera: 'connected', microphone: 'connected' }
    } catch {
      this.status = { ...this.status, camera: 'error', microphone: 'error' }
    }
    this.emit()
    this.sendStatus()
  }

  async checkScreen(): Promise<void> {
    this.status = { ...this.status, screen: 'connecting' }
    this.emit()
    try {
      this.screenStream = await getScreenShare()
      const [track] = this.screenStream.getVideoTracks()
      track?.addEventListener('ended', () => {
        this.status = { ...this.status, screen: 'disconnected' }
        this.emit()
        this.sendStatus()
      })
      this.status = { ...this.status, screen: 'connected' }
    } catch {
      this.status = { ...this.status, screen: 'error' }
    }
    this.emit()
    this.sendStatus()
  }

  private sendStatus() {
    this.signaling?.send({ type: 'media-status', payload: this.status })
  }

  /** Begin publishing camera + screen tracks over WebRTC. Requires both streams to be ready. */
  startWebRTC(): void {
    if (this.peerManager || !this.cameraStream || !this.screenStream || !this.signaling) return

    this.status = { ...this.status, webrtc: 'connecting' }
    this.emit()
    this.sendStatus()

    this.peerManager = new CandidatePeerManager(
      this.signaling,
      this.cameraStream,
      this.screenStream,
      (state) => {
        if (state === 'connected') {
          this.status = { ...this.status, webrtc: 'connected' }
          this.emit()
          this.sendStatus()
        } else if (state === 'failed' || state === 'disconnected' || state === 'closed') {
          this.status = { ...this.status, webrtc: 'disconnected' }
          this.emit()
          this.sendStatus()
        }
      },
    )

    this.pendingOfferRequests.forEach((proctorId) => this.peerManager?.handleRequestOffer(proctorId))
    this.pendingOfferRequests.clear()
  }

  get readyToStart(): boolean {
    return this.status.camera === 'connected' && this.status.microphone === 'connected' && this.status.screen === 'connected'
  }
}

export const candidateSession = new CandidateSession()

export function useCandidateSession() {
  const [, forceRender] = useState(0)
  useEffect(() => candidateSession.subscribe(() => forceRender((n) => n + 1)), [])
  return candidateSession
}
