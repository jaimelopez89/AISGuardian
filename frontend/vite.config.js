import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/kafka': {
        target: 'http://localhost:8082',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/kafka/, ''),
        configure: (proxy) => {
          proxy.on('error', (err) => {
            console.log('proxy error', err)
          })
          proxy.on('proxyReq', (proxyReq, req) => {
            console.log('Proxying:', req.method, req.url)
          })
          proxy.on('proxyRes', (proxyRes, req) => {
            console.log('Response:', proxyRes.statusCode, req.url)
          })
        }
      }
    }
  },
  build: {
    rollupOptions: {
      output: {
        // Use function to ensure React is in a shared vendor chunk, not duplicated
        manualChunks(id) {
          // React must be in its own shared chunk to avoid duplication
          if (id.includes('node_modules/react/') || id.includes('node_modules/react-dom/')) {
            return 'vendor-react'
          }
          // Mapbox libraries
          if (id.includes('node_modules/mapbox-gl/') || id.includes('node_modules/react-map-gl/')) {
            return 'mapbox'
          }
          // Deck.gl libraries
          if (id.includes('node_modules/@deck.gl/')) {
            return 'deckgl'
          }
        }
      }
    }
  },
  define: {
    'process.env': {}
  }
})
