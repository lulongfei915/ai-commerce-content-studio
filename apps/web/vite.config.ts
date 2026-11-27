import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  cacheDir: `node_modules/.vite-${mode}`,
  optimizeDeps: { include: ['@xyflow/react'] },
  server: {
    port: 5173,
    proxy: { '/api': loadEnv(mode, '.', 'STUDIO_DEV_API').STUDIO_DEV_API ?? 'http://127.0.0.1:8000' },
  },
  preview: { port: 4173 },
}));
