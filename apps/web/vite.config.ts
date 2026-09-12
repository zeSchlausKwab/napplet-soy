import { defineConfig } from 'vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  plugins: [tailwind(), tanstackStart(), react()],
  optimizeDeps: { exclude: ['@resvg/resvg-js'] },
  ssr: { external: ['@resvg/resvg-js'] },
  server: { strictPort: true, allowedHosts: ['napplet.localhost'] },
});
