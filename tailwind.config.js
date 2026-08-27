/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    screens: {
      xs: "360px",
      sm: "640px",
      md: "768px",
      lg: "1024px",
      xl: "1280px",
      "2xl": "1536px",
    },
    extend: {
      colors: {
        paper: "#F6F5F4",
        surface: "#FFFFFF",
        ink: {
          DEFAULT: "#1C1A18",
          2: "#5C564F",
          3: "#8A837A",
          4: "#B3ACA2",
        },
        line: {
          DEFAULT: "#E3E0DA",
          soft: "#EFEDE9",
        },
        cobalt: {
          DEFAULT: "#1F5FE0",
          deep: "#1848AE",
          wash: "#EDF2FE",
        },
        teal: {
          DEFAULT: "#147D74",
          wash: "#E7F3F1",
        },
        clay: {
          DEFAULT: "#C2551F",
          wash: "#FBEFE8",
        },
        plum: {
          DEFAULT: "#6B4E9E",
          wash: "#F1ECFA",
        },
        lime: {
          DEFAULT: "#B4D633",
          deep: "#5C6E14",
          wash: "#F4F8E4",
        },
      },
      fontFamily: {
        sans: ['"Schibsted Grotesk Variable"', "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono Variable"', "ui-monospace", "monospace"],
      },
      fontSize: {
        eyebrow: ["11px", { lineHeight: "1.2", letterSpacing: "0.08em" }],
        micro: ["12px", { lineHeight: "1.35" }],
        eta: ["13px", { lineHeight: "1.4" }],
      },
      boxShadow: {
        card: "0 0.5px 1px rgba(28,26,24,0.03), 0 2px 5px rgba(28,26,24,0.03)",
        bar: "0 -1px 0 #E3E0DA, 0 -8px 24px rgba(28,26,24,0.05)",
        tray:
          "0 2px 6px rgba(28,26,24,0.06), 0 12px 28px rgba(28,26,24,0.1), 0 32px 64px rgba(28,26,24,0.12)",
      },
      borderRadius: {
        sm: "6px",
        md: "10px",
        lg: "14px",
        xl: "20px",
      },
    },
  },
  plugins: [],
};
