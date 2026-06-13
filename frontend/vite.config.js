// import { defineConfig } from 'vite'
// import react from '@vitejs/plugin-react'

// // https://vite.dev/config/
// export default defineConfig({
//   plugins: [react()],
//   server: {
//     host: true,
//     port: 5173,
//     allowedHosts: ['bharath.local', 'localhost']
//   }
// })


import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { fileURLToPath } from 'url'

// Pin env-file lookup to THIS folder (where vite.config.js lives), no
// matter which directory `npm run dev` is invoked from. Without this,
// .env.local was being missed when Vite was started from outside
// frontend/, producing VITE_API_URL = undefined.
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {

  const env = loadEnv(mode, __dirname, '');

  return {
    plugins: [react()],
    envDir: __dirname,
    server: {
      host: '0.0.0.0',
      // Allow Cloudflare Tunnel + ngrok hosts. The leading "." is
      // Vite's suffix-match syntax — any subdomain is accepted.
      allowedHosts: [
        '.trycloudflare.com',
        '.ngrok-free.dev',
        '.ngrok.io'
      ]
    },
    // Force VITE_API_URL into the client bundle. Belt-and-braces in
    // case Vite's own env loading fails for whatever reason.
    define: {
      'import.meta.env.VITE_API_URL': JSON.stringify(env.VITE_API_URL || '')
    }
  }
})