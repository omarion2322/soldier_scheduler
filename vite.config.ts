import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages serves the site at /<repo>/ for project pages.
// Override with VITE_BASE if you fork under a different repo name.
const base = process.env.VITE_BASE ?? '/soldier_scheduler/';

export default defineConfig({
  base,
  plugins: [react()],
});
