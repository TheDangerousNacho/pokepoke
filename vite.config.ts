import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// GitHub Pages serves a project site from /<repo>/, so assets need that prefix.
// Overridable via BASE_PATH for a different host or a local `vite preview`.
const base = process.env.BASE_PATH ?? '/pokepoke/'

// https://vite.dev/config/
export default defineConfig({
  base,
  plugins: [react()],
})
