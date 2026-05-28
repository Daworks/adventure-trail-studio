import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: "#f4f1ea",
        panel: "#fcfaf5",
        ink: "#23211d",
        muted: "#777067",
        line: "#d7d0c4",
        route: "#d35d31",
        moss: "#1f6b53",
      },
      fontFamily: {
        serif: ["SUIT", "ui-sans-serif", "system-ui", "sans-serif"],
        sans: ["SUIT", "ui-sans-serif", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
