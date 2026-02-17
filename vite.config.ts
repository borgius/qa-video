import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    ssr: true,
    target: 'node18',
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      input: {
        index: 'src/index.ts',
        server: 'src/server.ts',
        'tts-worker': 'src/tts-worker.ts',
      },
      output: {
        format: 'es',
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
      },
    },
  },
});
