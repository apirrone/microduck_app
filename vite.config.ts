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
        // .json deliberately excluded — /state.json is live telemetry,
        // never cache it. The duck kinematics.json is loaded once at
        // app start; network-fetch is fine.
        globPatterns: ["**/*.{js,css,html,svg,png,webp,stl}"],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        // Don't intercept the runtime/sim HTTP API. The PWA dev origin
        // is different from the API origin so workbox wouldn't try by
        // default, but spell it out so a future same-origin deploy
        // doesn't accidentally cache live data.
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
