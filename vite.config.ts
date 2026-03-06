import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Transient Splitter',
        short_name: 'TransientSplit',
        description: 'Split percussive and harmonic components from audio — runs entirely in your browser',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
    }),
  ],
  server: {
    watch: {
      ignored: ['**/wasm/**','**/dist/**'],
    },
    warmup: {
      clientFiles: ['./src/**/*.{ts,tsx}'],
    },
  },
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    entries: ['index.html'],
  },
})
