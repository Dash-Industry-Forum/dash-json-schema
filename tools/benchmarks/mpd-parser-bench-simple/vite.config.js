import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const benchRoot = fileURLToPath(new URL('.', import.meta.url))
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))

export default defineConfig({
  // Serve the repo's misc test vectors (livesim_very_large.mpd and its JSON)
  // as static files instead of keeping a copy under public/
  publicDir: path.resolve(repoRoot, 'test-vectors', 'misc'),
  build: {
    // Ensure assets are inlined or use relative paths for Tizen/WebOS
    assetsInlineLimit: 0,
    rollupOptions: {
      input: {
        main: path.resolve(benchRoot, 'index.html'),
      },
    },
  },
  // Allow loading the large static files from test-vectors/
  server: {
    fs: {
      allow: [benchRoot, repoRoot],
    },
  },
})
