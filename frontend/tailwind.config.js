/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#2D4A3E',
          light: '#3D6354',
          dark: '#1E3228',
        },
        accent: {
          DEFAULT: '#C4623A',
          light: '#D4784F',
          dark: '#A84E2A',
        },
        sand: {
          DEFAULT: '#E8D5B7',
          light: '#F0E3CC',
          dark: '#D4BC96',
        },
        cream: {
          DEFAULT: '#FAF7F2',
          dark: '#F0EAE0',
        },
      },
      fontFamily: {
        display: ['"Playfair Display"', 'Georgia', 'serif'],
        sans: ['"Source Sans 3"', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        'paper': '0 1px 3px rgba(45,74,62,0.08), 0 4px 16px rgba(45,74,62,0.06), inset 0 1px 0 rgba(255,255,255,0.6)',
        'paper-hover': '0 4px 8px rgba(45,74,62,0.12), 0 12px 32px rgba(45,74,62,0.10), inset 0 1px 0 rgba(255,255,255,0.6)',
        'card': '0 2px 8px rgba(45,74,62,0.10), 0 1px 2px rgba(45,74,62,0.06)',
      },
      backgroundImage: {
        'paper-texture': "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='4' height='4'%3E%3Crect width='4' height='4' fill='%23E8D5B7'/%3E%3Crect x='0' y='0' width='1' height='1' fill='%23E0CAA8' opacity='0.4'/%3E%3Crect x='2' y='2' width='1' height='1' fill='%23F0DFC0' opacity='0.3'/%3E%3C/svg%3E\")",
      },
      animation: {
        'fade-in': 'fadeIn 0.2s ease-out',
        'slide-up': 'slideUp 0.25s ease-out',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
}
