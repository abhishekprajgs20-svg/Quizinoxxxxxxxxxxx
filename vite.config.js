import { defineConfig } from 'vite';
export default defineConfig({
  base: './',
  build: { target: 'es2020', sourcemap: false },
  server: { host: '0.0.0.0' }
});