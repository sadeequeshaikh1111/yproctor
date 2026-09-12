import type { Identity, SignalMessage } from '../types'

const BACKEND_PORT = (import.meta as any).env?.VITE_WS_PORT || '8000'

/**
 * Resolve the signalling WebSocket base URL.
 *
 * Explicit override: set VITE_WS_BASE to point at a backend running
 * somewhere else entirely.
 *
 * Otherwise, derive it from the page itself: same hostname the browser
 * used to load the app (so this works unchanged from localhost or from
 * a phone hitting the dev machine's LAN IP), and ws:// vs wss:// matching
 * the page's own protocol. This matters because a page served over
 * https:// is only allowed to open wss:// connections - mixing in a
 * plain ws:// call gets silently blocked as mixed content.
 */
function resolveWsBase(): string {
  const override = (import.meta as any).env?.VITE_WS_BASE
  if (override) return override

  const isSecure = window.location.protocol === 'https:'
  const scheme = isSecure ? 'wss' : 'ws'
  return `${scheme}://${window.location.hostname}:${BACKEND_PORT}`
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
