/** @type {import('tailwindcss').Config} */
const STAGES = ['writing', 'tracking', 'overdubs', 'producing', 'stems', 'mixing', 'mastering', 'done']
const OPACITIES = ['10', '20', '30', '40', '50', '60', '70']

const safelist = []
for (const s of STAGES) {
  safelist.push(`bg-stage-${s}`, `text-stage-${s}`, `border-stage-${s}`)
  for (const o of OPACITIES) {
    safelist.push(
      `bg-stage-${s}/${o}`,
      `border-stage-${s}/${o}`,
      `text-stage-${s}/${o}`,
      `from-stage-${s}/${o}`,
      `via-stage-${s}/${o}`,
      `to-stage-${s}/${o}`,
    )
  }
}

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  safelist,
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
