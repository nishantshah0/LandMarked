import { resolve } from 'node:path'
import { defineConfig } from 'vite'

export default defineConfig({
  root: 'web',
  build: {
    outDir: '../web-dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'web/index.html'),
        dashboard: resolve(__dirname, 'web/dashboard.html'),
        now: resolve(__dirname, 'web/now.html'),
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/ws': { target: 'ws://localhost:8787', ws: true },
      '/api': 'http://localhost:8787',
      '/photos': 'http://localhost:8787',
    },
  },
})
