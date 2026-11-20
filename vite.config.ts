import { defineConfig } from 'vite';

// `base: './'` makes every asset path relative, so the build works on
// GitHub Pages no matter what the repository is called.
export default defineConfig({
  base: './',
  build: {
    chunkSizeWarningLimit: 2000,
  },
});
