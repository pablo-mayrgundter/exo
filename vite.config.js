import { defineConfig } from 'vite'

// Relative base, so the build works at exo.cafe/, in its PR previews under
// pr-preview/, and at pablo-mayrgundter.github.io/exo/ alike.
export default defineConfig({
  base: './',
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
  worker: { format: 'es' },
  test: { testTimeout: 120000 },
})
