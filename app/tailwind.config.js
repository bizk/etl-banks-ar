/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: "#006c49",
        "primary-container": "#10b981",
        secondary: "#2b6954",
        "secondary-container": "#adedd3",
        tertiary: "#a43a3a",
        background: "#f8f9fa",
        surface: "#f8f9fa",
        "surface-container": "#edeeef",
        "surface-container-low": "#f3f4f5",
        "surface-container-lowest": "#ffffff",
        "on-surface": "#191c1d",
        "on-surface-variant": "#3c4a42",
        error: "#ba1a1a",
      },
      fontFamily: {
        headline: ["Manrope", "sans-serif"],
        body: ["Inter", "sans-serif"],
      },
    },
  },
  plugins: [],
}
