import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// Tailwind runs via postcss.config.js (@tailwindcss/postcss) to avoid
// @tailwindcss/vite + @tailwindcss/node esm-cache.loader resolve issues with Vite internals.

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
})
