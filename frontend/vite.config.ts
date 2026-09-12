import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'

// getUserMedia()/getDisplayMedia() only work in a "secure context". The
// browser treats https:// and http://localhost as secure, but NOT
// http://<lan-ip>. So when testing from another device on the LAN, this
// dev server needs to serve over https. Run ../generate-certs.sh once to
// create certs/cert.pem + certs/key.pem (shared with the backend); if
// they're absent, Vite just falls back to plain http for local dev.
const certDir = path.resolve(__dirname, '../certs')
const keyPath = path.join(certDir, 'key.pem')
const certPath = path.join(certDir, 'cert.pem')
const httpsConfig =
  fs.existsSync(keyPath) && fs.existsSync(certPath)
    ? { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) }
    : undefined

// Backend that the dev server proxies /api and /ws to. Point this at the
// backend if it runs elsewhere or without TLS:
//   VITE_PROXY_TARGET=http://192.168.1.200:8000 npm run dev
const proxyTarget = process.env.VITE_PROXY_TARGET || 'https://127.0.0.1:8000'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true, // listen on 0.0.0.0 so other devices on the LAN can reach it
    https: httpsConfig,
    proxy: {
      // Route API + signalling through this same origin so the browser only
      // ever needs to trust ONE certificate (the frontend's). Without this,
      // every device has to separately accept the backend's self-signed cert
      // on :8000 (certificate exceptions are per-origin) and the WebSocket on
      // an untrusted origin fails silently - both common "can't login" traps.
      '/api': {
        target: proxyTarget,
        changeOrigin: true,
        secure: false, // backend uses a self-signed dev certificate
      },
      '/ws': {
        target: proxyTarget,
        changeOrigin: true,
        secure: false,
        ws: true,
      },
    },
  },
})
