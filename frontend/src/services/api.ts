function resolveApiBase(): string {
  const override = (import.meta as any).env?.VITE_API_BASE
  if (override) return override
  // Same-origin: the Vite dev server proxies /api to the FastAPI backend
  // (see vite.config.ts). The browser then only needs to trust the frontend's
  // certificate - no separate "Proceed" for the backend on :8000.
  return ''
}

export const API_BASE = resolveApiBase()