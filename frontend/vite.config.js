import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development the API runs on port 3000; Vite forwards /api calls to it.
export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': 'http://localhost:3000' } },
});
