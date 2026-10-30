import { defineConfig } from 'vite'

// Relative base, so the build works at pablo-mayrgundter.github.io/exo/, in
// its PR previews, and at any domain later, alike.
export default defineConfig({
  base: './',
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
  worker: { format: 'es' },
  test: { testTimeout: 120000 },
})
