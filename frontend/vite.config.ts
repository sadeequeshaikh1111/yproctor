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

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true, // listen on 0.0.0.0 so other devices on the LAN can reach it
    https: httpsConfig,
  },
})
