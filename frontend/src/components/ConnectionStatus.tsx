import type { ConnState } from '../types'

const COLORS: Record<ConnState, string> = {
  pending: '#9ca3af',
  connecting: '#f59e0b',
  connected: '#22c55e',
  disconnected: '#ef4444',
  error: '#ef4444',
}

const LABELS: Record<ConnState, string> = {
  pending: 'Not Connected',
  connecting: 'Connecting',
  connected: 'Connected',
  disconnected: 'Disconnected',
  error: 'Error',
}

export default function ConnectionStatus({ label, state }: { label: string; state: ConnState }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: COLORS[state],
          display: 'inline-block',
          flexShrink: 0,
        }}
      />
      <span style={{ color: '#374151' }}>
        {label}: <strong style={{ color: COLORS[state] }}>{LABELS[state]}</strong>
      </span>
    </div>
  )
}
