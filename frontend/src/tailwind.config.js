/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,jsx,ts,tsx}"],
  darkMode: "class", // you used .dark in your CSS
  theme: {
    extend: {
      colors: {
        // UI variables
        "bg-primary": "var(--bg-primary)",
        "bg-secondary": "var(--bg-secondary)",
        "text-primary": "var(--text-primary)",
        "text-secondary": "var(--text-secondary)",
        "text-white": "var(--text-white)",

        // token-style variables (shadcn-like)
        background: "var(--background)",
        foreground: "var(--foreground)",
        card: "var(--card)",
        "card-foreground": "var(--card-foreground)",
        popover: "var(--popover)",
        // add more mappings as needed...
      },
      borderRadius: {
        lg: "var(--radius)",
      },
    },
  },
  plugins: [],
};
