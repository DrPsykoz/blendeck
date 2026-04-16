/** @type {import('tailwindcss').Config} */
module.exports = {
    content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
    theme: {
        extend: {
            colors: {
                deck: {
                    bg: "#09090B",
                    card: "#111114",
                    surface: "#1A1A1E",
                    border: "#242429",
                    muted: "#2E2E34",
                },
                amber: {
                    DEFAULT: "#D4A044",
                    light: "#E8B86A",
                    dim: "#A67B2E",
                },
                sand: {
                    50: "#EDEAE5",
                    100: "#D4CFC7",
                    200: "#B5B0A8",
                    300: "#8F8B85",
                    400: "#5E5B65",
                    500: "#3E3E46",
                },
            },
            fontFamily: {
                sans: ["var(--font-manrope)", "system-ui", "sans-serif"],
                display: ["var(--font-outfit)", "system-ui", "sans-serif"],
                mono: ["var(--font-jetbrains)", "monospace"],
            },
            keyframes: {
                "fade-in-up": {
                    "0%": { opacity: "0", transform: "translateY(12px)" },
                    "100%": { opacity: "1", transform: "translateY(0)" },
                },
                "fade-in": {
                    "0%": { opacity: "0" },
                    "100%": { opacity: "1" },
                },
                "slide-in-right": {
                    "0%": { opacity: "0", transform: "translateX(16px)" },
                    "100%": { opacity: "1", transform: "translateX(0)" },
                },
                "glow-pulse": {
                    "0%, 100%": { boxShadow: "0 0 8px rgba(212, 160, 68, 0.2)" },
                    "50%": { boxShadow: "0 0 20px rgba(212, 160, 68, 0.4)" },
                },
            },
            animation: {
                "fade-in-up": "fade-in-up 0.5s cubic-bezier(0.22, 1, 0.36, 1) both",
                "fade-in": "fade-in 0.4s ease-out both",
                "slide-in-right": "slide-in-right 0.4s cubic-bezier(0.22, 1, 0.36, 1) both",
                "glow-pulse": "glow-pulse 2s ease-in-out infinite",
            },
        },
    },
    plugins: [],
};
