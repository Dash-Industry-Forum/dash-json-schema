import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const benchRoot = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  build: {
    // Ensure assets are inlined or use relative paths for Tizen/WebOS
    assetsInlineLimit: 0,
    rollupOptions: {
      input: {
        main: path.resolve(benchRoot, 'index.html'),
      },
    },
  },
  // Allow loading the large static files from public/
  server: {
    fs: {
      allow: [benchRoot],
    },
  },
})
