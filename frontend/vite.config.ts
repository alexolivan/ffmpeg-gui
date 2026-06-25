import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import fs from 'fs';
import path from 'path';

const packageJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8'));
const appVersion = packageJson.version;

const backendPort = process.env.BACKEND_PORT || '8000';

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(appVersion),
  },
  server: {
    proxy: {
      '/ws': {
        target: `ws://localhost:${backendPort}`,
        ws: true,
      },
      '/settings': `http://localhost:${backendPort}`,
      '/login': `http://localhost:${backendPort}`,
      '/builds': `http://localhost:${backendPort}`,
      '/processes': `http://localhost:${backendPort}`,
      '/tasks': `http://localhost:${backendPort}`,
      '/sdks': `http://localhost:${backendPort}`,
      '/uploads': `http://localhost:${backendPort}`,
      '/system': `http://localhost:${backendPort}`,
      '/decklink': `http://localhost:${backendPort}`,
    }
  }
})
