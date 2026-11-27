import { defineConfig } from 'vite';

// `base: './'` makes the build work from any URL path, including the
// GitHub Pages project URL (https://<user>.github.io/WarRoom/).
export default defineConfig({
  root: 'client',
  base: './',
  publicDir: false,
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    target: 'es2022',
  },
  worker: {
    format: 'es',
  },
});
