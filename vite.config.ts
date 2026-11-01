import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// GitHub Pages serves a project repo from https://<user>.github.io/<repo>/ so assets need that prefix.
// A user/organisation site repo (named <user>.github.io) is served from the root.
const repoName = process.env.GITHUB_REPOSITORY?.split('/')[1];
const BASE_PATH = !repoName || repoName.endsWith('.github.io') ? '/' : `/${repoName}/`;

export default defineConfig({
  base: BASE_PATH,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'KrishiBazar AI — কৃষিবাজার AI',
        short_name: 'KrishiBazar',
        description: 'Bangladesh Smart Agricultural Supply Chain',
        theme_color: '#16a34a',
        background_color: '#f0fdf4',
        display: 'standalone',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
      },
    }),
  ],
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
          charts: ['recharts'],
        },
      },
    },
  },
});
