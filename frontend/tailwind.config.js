/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        dsos: {
          void: "#0a0506",
          black: "#120709",
          ember: "#1a0a0c",
          coal: "#241013",
          ash: "#3a1e22",
          blood: "#7a1218",
          fire: "#c2261d",
          flame: "#ff4a1f",
          sun: "#ff8a2a",
          glow: "#ffb86a",
          bone: "#f4ead4",
          ghost: "#cfc4b0",
        },
      },
      fontFamily: {
        script: ['"Dancing Script"', '"Brush Script MT"', "cursive"],
        mono: ['"JetBrains Mono"', '"Fira Code"', "Consolas", "monospace"],
      },
      boxShadow: {
        ember: "0 0 24px rgba(255,74,31,0.35), 0 0 64px rgba(255,74,31,0.18)",
        horn: "0 0 40px rgba(255,138,42,0.6), 0 0 120px rgba(194,38,29,0.4)",
      },
      keyframes: {
        flicker: {
          "0%,100%": { opacity: "1" },
          "45%": { opacity: "0.78" },
          "55%": { opacity: "0.96" },
        },
        rise: {
          "0%": { transform: "translateY(40%)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
        glowPulse: {
          "0%,100%": { filter: "drop-shadow(0 0 10px rgba(255,74,31,0.6))" },
          "50%": { filter: "drop-shadow(0 0 30px rgba(255,138,42,0.9))" },
        },
      },
      animation: {
        flicker: "flicker 4s ease-in-out infinite",
        rise: "rise 1.6s ease-out forwards",
        glowPulse: "glowPulse 3.5s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
