import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  safelist: ['btn-primary', 'btn-secondary', 'btn-ghost', 'btn-danger'],
  theme: {
    extend: {
      colors: {
        ink: { 50: '#f7f8fa', 100: '#eef0f4', 200: '#dfe3ea', 300: '#c4cad6', 400: '#98a1b3', 500: '#6b7488', 600: '#4d5567', 700: '#373e4e', 800: '#232838', 900: '#141826', 950: '#0b0e18' },
        brand: { 50: '#fafafa', 100: '#f4f4f5', 200: '#e4e4e7', 300: '#d4d4d8', 400: '#a1a1aa', 500: '#71717a', 600: '#27272a', 700: '#18181b', 800: '#101012', 900: '#09090b' },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(16,24,40,0.04), 0 1px 3px rgba(16,24,40,0.06)',
        pop: '0 12px 32px -8px rgba(16,24,40,0.18), 0 2px 6px rgba(16,24,40,0.06)',
      },
    },
  },
  plugins: [],
};
export default config;
