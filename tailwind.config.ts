import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  darkMode: "class",
  theme: {
    extend: {
      screens: {
        xs: "480px",
      },
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
        // colour; 500–950 sit in the same family as the cream text and amber
        // accent instead of fighting them.
        ink: {
          50: "#fbf7f0",
          100: "#f4ece0",
          200: "#e6dcc4",
          300: "#cabfa8",
          400: "#a89b86",
          // 500 was #8a7c69, which lands at ~4.1:1 on the page background —
          // under AA for the small text it is actually used for (timestamps,
          // "nothing needed", footer legal). Lifted just enough to clear it.
          500: "#968873",
          600: "#5c5044",
          700: "#3a3129",
          // NEW: the missing step between a card (900) and a raised chip
          // (800). Without it, nested surfaces have to reuse 800 and the
          // hierarchy flattens — visible today in the leaderboard tabs.
          850: "#1d1712",
          800: "#241d17",
          900: "#17120e",
          950: "#0e0b09",
        },
        // NEW: one cool accent, used *only* for Verglas — the window card,
        // the footer link, the town nav. The room is amber; the town outside
        // is ice. Right now both are the same orange, so the contrast the
        // copy keeps promising never actually appears on screen.
        frost: {
          100: "#e8f2f6",
          200: "#cfe3ea",
          300: "#a9cbd8",
          400: "#7fb0c2",
          500: "#5b93a8",
          600: "#437687",
        },
      },
      fontFamily: {
        // These names now match the @font-face families declared in
        // globals.css, which are self-hosted from /public/fonts — so builds
        // still make no network calls, but the fonts actually render.
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["Fraunces", "Georgia", "ui-serif", "serif"],
        mono: ["JetBrains Mono", "Fira Code", "ui-monospace", "monospace"],
      },
      maxWidth: {
        // Reading measure. Excerpts previously ran the full 1248px container,
        // roughly 180 characters per line.
        measure: "68ch",
        "measure-wide": "76ch",
        "measure-tight": "58ch",
      },
      fontSize: {
        hero: ["3.5rem", { lineHeight: "1.05", letterSpacing: "-0.02em" }],
        section: ["1.875rem", { lineHeight: "1.2", letterSpacing: "-0.01em" }],
        // NEW: the sizes that currently get hand-rolled at call sites.
        display: ["4.5rem", { lineHeight: "1.02", letterSpacing: "-0.03em" }],
        subhead: ["1.375rem", { lineHeight: "1.35", letterSpacing: "-0.005em" }],
        eyebrow: ["0.6875rem", { lineHeight: "1", letterSpacing: "0.14em" }],
      },
      spacing: {
        // Consistent vertical rhythm between page sections. The home page
        // currently alternates mb-20 / pb-24 / mb-16 by hand.
        section: "5rem",
        "section-lg": "7rem",
      },
      borderRadius: {
        card: "1.25rem",
      },
      boxShadow: {
        // Elevation as tokens rather than four different inline box-shadows.
        card: "0 8px 32px -12px rgba(0, 0, 0, 0.7), inset 0 0 0 1px rgba(255, 255, 255, 0.03)",
        "card-hover":
          "0 18px 48px -16px rgba(0, 0, 0, 0.85), inset 0 0 0 1px rgba(185, 111, 44, 0.10), 0 0 80px -18px rgba(185, 111, 44, 0.28)",
        lamp: "0 0 60px -12px rgba(226, 165, 87, 0.35)",
        "inner-top": "inset 0 1px 0 0 rgba(255, 255, 255, 0.05)",
      },
      transitionTimingFunction: {
        // Everything on the site uses the browser default ease, which reads
        // mechanical. This is the standard "settle" curve.
        soft: "cubic-bezier(0.22, 1, 0.36, 1)",
      },
      animation: {
        "fade-in": "fadeIn 0.5s ease-out",
        "slide-up": "slideUp 0.5s ease-out",
        "pulse-glow": "pulseGlow 2s ease-in-out infinite",
        shimmer: "shimmer 2s linear infinite",
        "rise-in": "riseIn 0.55s cubic-bezier(0.22, 1, 0.36, 1) both",
        "float-slow": "floatSlow 9s ease-in-out infinite",
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
        riseIn: {
          "0%": { opacity: "0", transform: "translateY(14px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        floatSlow: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-6px)" },
        },
      },
    },
  },
  plugins: [],
};

export default config;