import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Never load the parent env into Vite: Coarena credentials belong to the gateway.
export default defineConfig({
  plugins: [react()],
  envDir: './.client-env',
  server: { proxy: { '/api': 'http://127.0.0.1:4318' } },
  css: { postcss: { plugins: [] } },
  build: { target: 'es2022', rollupOptions: { output: { manualChunks: { editor: ['@codemirror/view', '@codemirror/state', '@codemirror/lang-javascript', '@codemirror/lang-html', '@codemirror/lang-css'], vendor: ['react', 'react-dom'] } } } },
});
