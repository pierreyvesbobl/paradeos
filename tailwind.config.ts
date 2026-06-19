import typography from "@tailwindcss/typography";
import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";

const config: Config = {
  darkMode: ["class"],
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: { "2xl": "1400px" },
    },
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
        brand: ["var(--font-brand)", "Georgia", "Times New Roman", "serif"],
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
          50: "var(--ds-primary-50)",
          100: "var(--ds-primary-100)",
          200: "var(--ds-primary-200)",
          300: "var(--ds-primary-300)",
          400: "var(--ds-primary-400)",
          500: "var(--ds-primary-500)",
          600: "var(--ds-primary-600)",
          700: "var(--ds-primary-700)",
          800: "var(--ds-primary-800)",
          900: "var(--ds-primary-900)",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        ds: {
          app: "var(--ds-bg-app)",
          surface: "var(--ds-bg-surface)",
          sidebar: "var(--ds-bg-sidebar)",
          hover: "var(--ds-bg-hover)",
          press: "var(--ds-bg-press)",
          border: "var(--ds-border)",
          "border-strong": "var(--ds-border-strong)",
          text: "var(--ds-text)",
          "text-muted": "var(--ds-text-muted)",
          "text-tertiary": "var(--ds-text-tertiary)",
        },
        tint: {
          gray: {
            bg: "var(--ds-tint-gray-bg)",
            text: "var(--ds-tint-gray-text)",
            dot: "var(--ds-tint-gray-dot)",
          },
          brown: {
            bg: "var(--ds-tint-brown-bg)",
            text: "var(--ds-tint-brown-text)",
            dot: "var(--ds-tint-brown-dot)",
          },
          orange: {
            bg: "var(--ds-tint-orange-bg)",
            text: "var(--ds-tint-orange-text)",
            dot: "var(--ds-tint-orange-dot)",
          },
          yellow: {
            bg: "var(--ds-tint-yellow-bg)",
            text: "var(--ds-tint-yellow-text)",
            dot: "var(--ds-tint-yellow-dot)",
          },
          green: {
            bg: "var(--ds-tint-green-bg)",
            text: "var(--ds-tint-green-text)",
            dot: "var(--ds-tint-green-dot)",
          },
          blue: {
            bg: "var(--ds-tint-blue-bg)",
            text: "var(--ds-tint-blue-text)",
            dot: "var(--ds-tint-blue-dot)",
          },
          mauve: {
            bg: "var(--ds-tint-mauve-bg)",
            text: "var(--ds-tint-mauve-text)",
            dot: "var(--ds-tint-mauve-dot)",
          },
          pink: {
            bg: "var(--ds-tint-pink-bg)",
            text: "var(--ds-tint-pink-text)",
            dot: "var(--ds-tint-pink-dot)",
          },
          red: {
            bg: "var(--ds-tint-red-bg)",
            text: "var(--ds-tint-red-text)",
            dot: "var(--ds-tint-red-dot)",
          },
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [animate, typography],
};

export default config;
