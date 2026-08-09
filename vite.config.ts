import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite-devpalvelin ajaa React-frontendin (oletusportti 5173) ja välittää
// kaikki /api-kutsut paikalliselle Node-välipalvelimelle (server/index.mjs,
// portti 3001), joka hakee ja purkaa HSL:n GTFS-RT-ajoneuvodatan.
// Tämä poistaa CORS-ongelmat kokonaan devissä, koska selain puhuu vain omaan originiinsa.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});