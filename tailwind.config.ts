import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        vb: {
          50: "#fdf3e4",
          100: "#f8e2c0",
          200: "#efc588",
          300: "#e2a557",
          400: "#d1883c",
          500: "#b96f2c",
          600: "#9c5a22",
          700: "#7c451c",
          800: "#5c331a",
          900: "#402413",
          950: "#26150b",
        },
        // Warm neutrals. 200–400 are unchanged so existing text keeps its
        // colour; 500–950 moved from cool navy to warm browns so surfaces
        // and borders sit in the same family as the cream text and amber
        // accent instead of fighting them.
        ink: {
          50: "#fbf7f0",
          100: "#f4ece0",
          200: "#e6dcc4",
          300: "#cabfa8",
          400: "#a89b86",
          500: "#8a7c69",
          600: "#5c5044",
          700: "#3a3129",
          800: "#241d17",
          900: "#17120e",
          950: "#0e0b09",
        },
      },
      fontFamily: {
        // next/font sets these variables in layout.tsx. Naming the families
        // directly meant the optimized fonts were never actually used.
        sans: ["var(--font-inter)", "Inter", "system-ui", "sans-serif"],
        display: ["var(--font-fraunces)", "Fraunces", "Georgia", "serif"],
        mono: ["var(--font-mono)", "JetBrains Mono", "Fira Code", "monospace"],
      },
      maxWidth: {
        // Reading measure. Excerpts previously ran the full 1248px container,
        // roughly 180 characters per line.
        measure: "68ch",
        "measure-wide": "76ch",
      },
      fontSize: {
        hero: ["3.5rem", { lineHeight: "1.05", letterSpacing: "-0.02em" }],
        section: ["1.875rem", { lineHeight: "1.2", letterSpacing: "-0.01em" }],
      },
      animation: {
        "fade-in": "fadeIn 0.5s ease-out",
        "slide-up": "slideUp 0.5s ease-out",
        "pulse-glow": "pulseGlow 2s ease-in-out infinite",
        shimmer: "shimmer 2s linear infinite",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        slideUp: {
          "0%": { opacity: "0", transform: "translateY(20px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        pulseGlow: {
          "0%, 100%": { boxShadow: "0 0 20px rgba(185, 111, 44, 0.35)" },
          "50%": { boxShadow: "0 0 40px rgba(185, 111, 44, 0.7)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
      },
    },
  },
  plugins: [],
};

export default config;