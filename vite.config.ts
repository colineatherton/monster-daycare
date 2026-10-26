import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The GitHub Pages site lives under /monster-daycare/, but only in Actions.
// Local dev and preview stay at the root.
export default defineConfig({
  plugins: [react()],
  base: process.env.GITHUB_ACTIONS ? '/monster-daycare/' : '/',
});
