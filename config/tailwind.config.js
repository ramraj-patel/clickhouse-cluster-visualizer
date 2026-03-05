/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        ch: {
          bg: '#0f1117',
          surface: '#1a1d27',
          border: '#2a2d3e',
          accent: '#ffcc00',
          text: '#e2e8f0',
          muted: '#64748b',
        },
      },
    },
  },
  plugins: [],
}
