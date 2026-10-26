import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The GitHub Pages site lives under /monster-daycare/, but only in Actions.
// ARTIFACT=1 builds with relative paths instead, for publishing the built game
// somewhere that is not the root of its own domain. Local dev stays at the root.
export default defineConfig({
  plugins: [react()],
  base: process.env.ARTIFACT ? './' : process.env.GITHUB_ACTIONS ? '/monster-daycare/' : '/',
});
