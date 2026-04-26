/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['"Bebas Neue"', 'Impact', 'sans-serif'],
        body: ['Inter', 'system-ui', 'sans-serif'],
      },
      colors: {
        ink: '#0b0d12',
        panel: '#141821',
        line: '#222633',
        muted: '#7a8294',
        text: '#e6e9f2',
        stage: {
          writing: '#94a3b8',
          tracking: '#fbbf24',
          overdubs: '#fb923c',
          producing: '#a78bfa',
          stems: '#60a5fa',
          mixing: '#2dd4bf',
          mastering: '#f472b6',
          done: '#34d399',
        },
        urgent: '#ef4444',
      },
      keyframes: {
        pulseRed: {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(239,68,68,0.6)' },
          '50%': { boxShadow: '0 0 0 8px rgba(239,68,68,0)' },
        },
      },
      animation: {
        pulseRed: 'pulseRed 1.6s ease-out infinite',
      },
    },
  },
  plugins: [],
}
