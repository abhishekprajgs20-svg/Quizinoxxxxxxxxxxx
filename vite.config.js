import { defineConfig } from 'vite';
export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
    sourcemap: false,
    chunkSizeWarningLimit: 2500,
    rollupOptions: {
      output: {
        // Android WebView serves *.mjs without a JavaScript MIME type, which breaks the PDF worker.
        // Ship every asset that would be .mjs as .js instead.
        assetFileNames: info => (info.names?.[0] || info.name || '').endsWith('.mjs') ? 'assets/[name]-[hash].js' : 'assets/[name]-[hash][extname]'
      }
    }
  },
  server: { host: '0.0.0.0' }
});
