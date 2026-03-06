import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
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
