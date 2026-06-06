import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  '#eef2fa',
          100: '#dce6f4',
          200: '#bacde9',
          300: '#8aa8d8',
          400: '#5375B0',
          500: '#1A4780',
          600: '#163d6e',
          700: '#12325b',
          800: '#0d2647',
          900: '#091b34',
        },
      },
    },
  },
  plugins: [],
} satisfies Config
