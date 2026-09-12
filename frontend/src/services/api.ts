function resolveApiBase(): string {
  const override = (import.meta as any).env?.VITE_API_BASE
  if (override) return override
  const isSecure = window.location.protocol === 'https:'
  const scheme = isSecure ? 'https' : 'http'
  const port = (import.meta as any).env?.VITE_WS_PORT || '8000'
  return `${scheme}://${window.location.hostname}:${port}`
}

export const API_BASE = resolveApiBase()