import type { Identity, SignalMessage } from '../types'

/**
 * Resolve the signalling WebSocket base URL.
 *
 * Explicit override: set VITE_WS_BASE to point at a backend running
 * somewhere else entirely.
 *
 * Otherwise use the page's own origin: the Vite dev server proxies /ws to
 * the backend (see vite.config.ts), so the browser only ever touches one
 * origin and one certificate. wss:// when the page is https, else ws:// -
 * a page served over https can only open wss:// connections (plain ws://
 * gets silently blocked as mixed content).
 */
function resolveWsBase(): string {
  const override = (import.meta as any).env?.VITE_WS_BASE
  if (override) return override

  const isSecure = window.location.protocol === 'https:'
  const scheme = isSecure ? 'wss' : 'ws'
  return `${scheme}://${window.location.host}`
}

const WS_BASE = resolveWsBase()

type Listener = (message: SignalMessage) => void

export class SignalingClient {
  private ws: WebSocket | null = null
  private listeners: Set<Listener> = new Set()
  private identity: Identity
  private pingTimer: number | undefined

  constructor(identity: Identity) {
    this.identity = identity
  }

  connect(): Promise<void> {
  const { room, role, id, token } = this.identity
  const url = `${WS_BASE}/ws/${encodeURIComponent(room)}/${role}/${encodeURIComponent(id)}?token=${encodeURIComponent(token)}`

    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url)
      this.ws = socket

      socket.onopen = () => {
        this.pingTimer = window.setInterval(() => {
          this.send({ type: 'ping' })
        }, 25000)
        resolve()
      }

      socket.onmessage = (event) => {
        try {
          const message: SignalMessage = JSON.parse(event.data)
          this.listeners.forEach((listener) => listener(message))
        } catch {
          // ignore malformed messages
        }
      }

      socket.onerror = () => {
        reject(new Error('WebSocket connection failed'))
      }

      socket.onclose = () => {
        if (this.pingTimer) window.clearInterval(this.pingTimer)
      }
    })
  }

  onMessage(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  send(message: SignalMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message))
    }
  }

  close(): void {
    if (this.pingTimer) window.clearInterval(this.pingTimer)
    this.ws?.close()
    this.ws = null
    this.listeners.clear()
  }
}
