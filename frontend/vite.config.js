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
    // Prevent chunk splitting issues that cause "Failed to fetch dynamically imported module"
    rollupOptions: {
      output: {
        manualChunks: {
          'mapbox': ['mapbox-gl', 'react-map-gl'],
          'deckgl': ['@deck.gl/core', '@deck.gl/layers', '@deck.gl/react', '@deck.gl/mapbox'],
        }
      }
    }
  },
  define: {
    'process.env': {}
  }
})
