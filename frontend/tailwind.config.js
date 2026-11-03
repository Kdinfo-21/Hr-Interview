/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
        display: ['"Fraunces"', "ui-serif", "Georgia", "serif"],
      },
      colors: {
        // Cool, professional blue-gray neutrals — the app's base surface palette.
        ink: {
          50: "#F7F8FA",
          100: "#EEF1F4",
          150: "#E6EAEF",
          200: "#DCE1E8",
          300: "#C2C9D3",
          400: "#9BA4B2",
          500: "#717C8B",
          600: "#545F6F",
          700: "#3D4653",
          800: "#262D38",
          900: "#171C24",
          950: "#0E1116",
        },
        // Deep petrol/teal — the single accent color, used deliberately.
        brand: {
          50: "#EEF6F5",
          100: "#D4E9E6",
          200: "#A9D3CC",
          300: "#7DBBB1",
          400: "#549E92",
          500: "#3D8377",
          600: "#306A60",
          700: "#27544D",
          800: "#20433D",
          900: "#1A3531",
        },
        surface: {
          50: "#EEF1F4",
          100: "#FFFFFF",
        },
      },
      boxShadow: {
        card: "0 1px 2px 0 rgba(23, 28, 36, 0.05), 0 1px 8px -2px rgba(23, 28, 36, 0.06)",
        "card-hover": "0 8px 24px -8px rgba(23, 28, 36, 0.14), 0 2px 8px -2px rgba(23, 28, 36, 0.08)",
        panel: "0 1px 3px 0 rgba(23, 28, 36, 0.06)",
        glow: "0 0 0 4px rgba(61, 131, 119, 0.14)",
        brand: "0 6px 18px -6px rgba(48, 106, 96, 0.38)",
      },
      borderRadius: {
        xl2: "1.1rem",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0", transform: "translateY(4px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        popIn: {
          "0%": { opacity: "0", transform: "scale(0.97)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
      },
      animation: {
        fadeIn: "fadeIn 0.35s ease-out",
        popIn: "popIn 0.2s ease-out",
      },
    },
  },
  plugins: [],
};
