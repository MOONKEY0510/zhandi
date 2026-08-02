import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    target: 'esnext',
    outDir: 'dist',
    sourcemap: false,
    minify: 'esbuild',
    rollupOptions: {
      output: {
        manualChunks: {
          'three': ['three'],
          'rapier': ['@dimforge/rapier3d-compat'],
        },
      },
    },
  },
  server: {
    port: 5173,
    host: true,
    open: true,
  },
  optimizeDeps: {
    include: ['three', '@dimforge/rapier3d-compat'],
  },
});
