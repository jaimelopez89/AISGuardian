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
    // Let Vite handle chunking automatically - manual chunking was causing React duplication issues
  },
  define: {
    'process.env': {}
  }
})
