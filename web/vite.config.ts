import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Served from the site root — see netlify.toml, which copies this
// project's build output over the repo root. This overwrites the old
// index.html in the deployed artifact only; the legacy file stays
// untouched in git, just no longer live.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
  },
});
