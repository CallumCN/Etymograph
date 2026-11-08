import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Served from /languages/ on the deployed site — see netlify.toml, which
// copies this project's build output into a `languages/` folder at the
// repo root so it coexists with the legacy index.html / auth.html.
export default defineConfig({
  plugins: [react()],
  base: '/languages/',
  build: {
    outDir: 'dist',
  },
});
