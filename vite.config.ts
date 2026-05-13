import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    solid(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["robot/**/*"],
      manifest: {
        name: "Microduck",
        short_name: "Microduck",
        description: "Companion app for the microduck robot",
        theme_color: "#fffdf6",
        background_color: "#fffdf6",
        display: "standalone",
        orientation: "any",
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "icons/icon-mask-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        // Precache only the lightweight app shell — HTML + JS + CSS +
        // icons. The 14 MB of STL meshes are NOT precached: that's
        // what made first install painfully slow over the Pi's
        // single-threaded server. They're served fresh on demand and
        // cached via `runtimeCaching` below, so once they're fetched
        // once they're available offline.
        globPatterns: ["**/*.{js,css,html,svg,png,webp}"],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.endsWith(".stl"),
            handler: "CacheFirst",
            options: {
              cacheName: "microduck-meshes",
              expiration: { maxEntries: 64, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: ({ url }) => url.pathname === "/robot/kinematics.json",
            handler: "CacheFirst",
            options: {
              cacheName: "microduck-rig",
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
        // Don't intercept the runtime/sim HTTP API.
        navigateFallbackDenylist: [/^\/state\.json/, /^\/map\.pgm/, /^\/goal/, /^\/command/],
      },
      // Dev SW disabled — kept causing stale /state.json and tripping
      // CORS in fetch interceptors. Service worker is only registered
      // in production builds, where workbox config above applies.
    }),
  ],
  server: {
    host: true,
    port: 5173,
  },
});
