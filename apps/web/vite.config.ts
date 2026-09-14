import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => {
  const base = mode === 'github-pages' ? '/CardGrader/' : '/';

  return {
    base,
    plugins: [
      react(),
      VitePWA({
        registerType: 'prompt',
        includeAssets: ['card-grader.svg'],
        manifest: {
          name: 'Card Grader',
          short_name: 'CardGrader',
          description:
            'Private, on-device Pokémon card condition capture and grading estimates.',
          theme_color: '#101820',
          background_color: '#101820',
          display: 'standalone',
          orientation: 'portrait',
          start_url: base,
          scope: base,
          icons: [
            {
              src: `${base}card-grader.svg`,
              sizes: 'any',
              type: 'image/svg+xml',
              purpose: 'any maskable',
            },
          ],
        },
        workbox: {
          clientsClaim: true,
          maximumFileSizeToCacheInBytes: 17 * 1024 * 1024,
          navigateFallback: `${base}index.html`,
          skipWaiting: true,
          runtimeCaching: [
            {
              urlPattern: new RegExp(`${base}models/`),
              handler: 'CacheFirst',
              options: {
                cacheName: 'cardgrader-models',
                expiration: {
                  maxEntries: 12,
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                },
              },
            },
          ],
        },
      }),
    ],
  };
});
