import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': 'http://127.0.0.1:4000' }, open: '/frontend/' },
  build: { rollupOptions: { input: { frontend: resolve('frontend/index.html'), admin: resolve('admin/index.html') } } },
});
