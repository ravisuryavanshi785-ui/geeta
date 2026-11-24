import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

function disableHmrWebSocketClient(): Plugin {
  let hmrDisabled = false;
  return {
    name: 'disable-hmr-websocket-client',
    apply: 'serve',
    enforce: 'post',
    configResolved(resolved) {
      hmrDisabled = resolved.server.hmr === false || resolved.server.ws === false;
    },
    transform(code, id) {
      if (!hmrDisabled) return null;
      const normalizedId = id.replace(/\\/g, '/');
      if (!normalizedId.endsWith('/vite/dist/client/client.mjs')) return null;
      if (!code.includes('createWebSocketModuleRunnerTransport')) return null;
      const updated = code
        .replace(
          'console.debug("[vite] connecting...");\n',
          ''
        )
        .replace(
          /const transport = normalizeModuleRunnerTransport\([\s\S]*?\n\);\n/,
          'const transport = normalizeModuleRunnerTransport({ async connect() {}, async disconnect() {}, send() {} });\n'
        );
      if (updated === code) return null;
      return { code: updated, map: null };
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    disableHmrWebSocketClient(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'apple-touch-icon.png', 'pwa-192x192.png', 'pwa-512x512.png'],
      manifest: {
        id: '/',
        name: 'RS Movie Spot — AI 3D Video Studio',
        short_name: 'RSMovieSpot',
        description:
          'AI 3D Character Video Studio for Shorts (9:16) and YouTube (16:9) with sculpted 3D characters, voiceover, subtitles, and MP4 export.',
        theme_color: '#0B0F0D',
        background_color: '#0B0F0D',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          {
            src: '/pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/pwa-maskable-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        navigateFallbackDenylist: [/^\/api\//, /^\/downloads\//],
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365,
              },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'gstatic-fonts-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365,
              },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: {
        enabled: true,
        type: 'module',
      },
    }),
  ],
  server: {
    host: '0.0.0.0',
    port: 3000,
    hmr: false,
    ws: false,
  },
});
