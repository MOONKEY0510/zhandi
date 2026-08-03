import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => ({
  base: './',
  build: {
    target: 'esnext',
    outDir: mode === 'check' ? 'dist-check' : 'dist',
    emptyOutDir: mode !== 'check',
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
}));
