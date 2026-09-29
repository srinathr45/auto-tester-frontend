import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

function proxyTarget(mode: string): string {
  const env = loadEnv(mode, process.cwd(), '');
  const raw =
    env.API_BACKEND_URL ||
    env.VITE_API_BACKEND_URL ||
    env.VITE_API_URL ||
    'http://127.0.0.1:3001';
  return raw.replace(/\/+$/, '').replace(/\/api$/i, '');
}

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  // Relative asset paths so Electron can load dist/ via file://
  base: './',
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: proxyTarget(mode),
        changeOrigin: true,
      },
    },
  },
}));
