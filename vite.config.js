import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/** Serve `index.html` for `/privacy`, `/terms`, `/about` so dev matches production SPA routing. */
function spaLegalRoutesPlugin() {
  const paths = new Set(['/privacy', '/terms', '/about']);
  return {
    name: 'spa-legal-routes',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const raw = req.url?.split(/[?#]/)[0] ?? '';
        if (paths.has(raw)) {
          const qs = req.url?.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
          req.url = '/' + qs;
        }
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), spaLegalRoutesPlugin()],
  server: {
    proxy: {
      '/tmdb-images': {
        target: 'https://image.tmdb.org',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/tmdb-images/, ''),
      },
    },
  },
})