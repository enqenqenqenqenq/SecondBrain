import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // На GitHub Pages приложение лежит в подпапке с именем репозитория.
  base: process.env.GITHUB_ACTIONS ? '/SecondBrain/' : '/',
  plugins: [react()],
})
