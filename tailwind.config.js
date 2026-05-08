/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Warm, light tamagotchi-ish palette.
        cream: {
          50: "#fffdf6",
          100: "#fbf6e7",
          200: "#f3ead0",
          300: "#e7dab0",
        },
        slate2: {
          900: "#1c2740",
          800: "#2a3859",
          600: "#54648a",
          400: "#94a0bf",
          300: "#c2cbe0",
          100: "#e8edf7",
        },
        duck: {
          400: "#ffe27a",
          500: "#ffcd3a",
          600: "#f0b522",
          700: "#c98e10",
        },
        mint: {
          300: "#b9f0d8",
          500: "#3dd9a0",
          600: "#27b482",
        },
        coral: {
          400: "#ff8d7a",
          500: "#ff6d56",
        },
      },
      fontFamily: {
        sans: [
          "Nunito",
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      boxShadow: {
        card: "0 1px 0 rgba(255,255,255,0.6) inset, 0 8px 24px -10px rgba(28,39,64,0.18)",
        soft: "0 6px 22px -10px rgba(28,39,64,0.22)",
        glow: "0 8px 28px -10px rgba(61,217,160,0.45)",
      },
      animation: {
        breathe: "breathe 4s ease-in-out infinite",
        zfloat: "zfloat 3s ease-in-out infinite",
      },
      keyframes: {
        breathe: {
          "0%, 100%": { transform: "scale(1)" },
          "50%": { transform: "scale(1.03)" },
        },
        zfloat: {
          "0%": { transform: "translate(0,0) scale(0.8)", opacity: "0" },
          "20%": { opacity: "0.9" },
          "100%": { transform: "translate(28px,-46px) scale(1.2)", opacity: "0" },
        },
      },
    },
  },
  plugins: [],
};
