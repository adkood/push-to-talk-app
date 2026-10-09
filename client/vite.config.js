import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // Listen on all network interfaces (0.0.0.0)
    port: 5173,
    allowedHosts: true, // Allow tunnel domains
    proxy: {
      '/ws': {
        target: 'ws://localhost:5000',
        ws: true,
      },
    },
  },
})
