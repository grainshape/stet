import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vitest/config'

// Component and input tests will run in a real browser (Vitest browser mode with Playwright)
// once the DOM input layer exists. Until then this only runs plain unit tests.
export default defineConfig({
  plugins: [svelte()],
  test: {
    include: ['src/**/*.test.ts'],
  },
})
