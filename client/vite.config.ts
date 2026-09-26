import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: { '/api': { target: 'http://127.0.0.1:8787', changeOrigin: false } },
  },
  build: {
    // Tout le livrable est regroupé dans le dossier dist/ à la racine (serveur + interface dans dist/public).
    outDir: '../dist/public',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: (id) => (id.includes('node_modules/react-markdown') || id.includes('node_modules/remark') || id.includes('node_modules/micromark') || id.includes('node_modules/mdast') ? 'markdown' : undefined),
      },
    },
  },
});
