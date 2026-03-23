import type { Config } from "tailwindcss";
const config: Config = {
  darkMode: ["class", '[data-theme="dark"]'],
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: {
          primary: "var(--color-bg-primary)",
          secondary: "var(--color-bg-secondary)",
          elevated: "var(--color-bg-elevated)",
        },
        text: {
          primary: "var(--color-text-primary)",
          secondary: "var(--color-text-secondary)",
          tertiary: "var(--color-text-tertiary)",
        },
        surface: {
          hover: "var(--color-surface-hover)",
        },
        brand: {
          DEFAULT: "var(--color-brand)",
          light: "var(--color-brand-light)",
          hover: "var(--color-brand-hover)",
        },
        success: "var(--color-success)",
        streak: "var(--color-streak)",
        miss: "var(--color-miss)",
        encourage: "var(--color-encourage)",
      },
      fontFamily: {
        sans: ["var(--font-sans)"],
        display: ["var(--font-display)"],
        mono: ["var(--font-mono)"],
      },
      borderRadius: {
        sm: "var(--radius-sm)",
        md: "var(--radius-md)",
        lg: "var(--radius-lg)",
        full: "var(--radius-full)",
      },
      boxShadow: {
        sm: "var(--shadow-sm)",
        md: "var(--shadow-md)",
        lg: "var(--shadow-lg)",
      },
      transitionTimingFunction: {
        "out-expo": "var(--ease-out)",
        bounce: "var(--ease-bounce)",
      },
    },
  },
};
export default config;
