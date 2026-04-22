/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        ch: {
          bg: 'var(--ch-bg)',
          surface: 'var(--ch-surface)',
          border: 'var(--ch-border)',
          accent: 'var(--ch-accent)',
          text: 'var(--ch-text)',
          muted: 'var(--ch-muted)',
          success: 'var(--ch-success)',
          warning: 'var(--ch-warning)',
          danger: 'var(--ch-danger)',
          info: 'var(--ch-info)',
          orange: 'var(--ch-orange)',
          purple: 'var(--ch-purple)',
        },
      },
    },
  },
  plugins: [],
}
