/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        background: '#0F0A07',
        surface: '#18100B',
        'surface-elevated': '#221610',
        'surface-border': '#351F14',
        orrange: {
          50: '#fff7ed',
          100: '#ffedd5',
          200: '#fed7aa',
          300: '#fdba74',
          400: '#F08A3C', // Bright accent
          500: '#C45B2C', // Top pick Copper Orange
          600: '#D76A24', // Deep Tangerine
          700: '#B85A24', // Burnt Apricot
          800: '#A94A22', // Amber Rust
          900: '#8F3F1F', // Deep background highlight
          950: '#0F0A07', // Obsidian base
          glow: '#F08A3C',
          copper: '#C45B2C',
          tangerine: '#D76A24',
          apricot: '#B85A24',
          amber: '#A94A22',
          base: '#8F3F1F',
          obsidian: '#0F0A07',
          card: '#18100B',
          bright: '#F08A3C',
        },
        brand: {
          50: '#fff7ed',
          400: '#F08A3C',
          500: '#C45B2C',
          600: '#D76A24',
        },
        shield: {
          light: '#F08A3C',
          DEFAULT: '#C45B2C',
          dark: '#8F3F1F',
        },
        strk: {
          accent: '#C45B2C',
          pool: '#D76A24',
        }
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'Courier New', 'monospace'],
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        display: ['Bebas Neue', 'Impact', 'Syne', 'sans-serif'],
        syne: ['Syne', 'sans-serif'],
        space: ['Space Grotesk', 'sans-serif'],
        bebas: ['Bebas Neue', 'Impact', 'sans-serif'],
      },
      animation: {
        'pulse-subtle': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'glow-spin': 'spin 8s linear infinite',
        'blink': 'blink 1s step-end infinite',
        'marquee': 'marquee 25s linear infinite',
        'marquee-reverse': 'marquee-reverse 25s linear infinite',
        'float-slow': 'float 6s ease-in-out infinite',
        'float-medium': 'float 4s ease-in-out infinite',
        'float-fast': 'float 2.5s ease-in-out infinite',
        'shimmer': 'shimmer 3s ease-in-out infinite',
        'radar': 'radar 2s cubic-bezier(0, 0, 0.2, 1) infinite',
      },
      keyframes: {
        blink: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0' },
        },
        marquee: {
          '0%': { transform: 'translateX(0%)' },
          '100%': { transform: 'translateX(-50%)' },
        },
        'marquee-reverse': {
          '0%': { transform: 'translateX(-50%)' },
          '100%': { transform: 'translateX(0%)' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0px) rotate(0deg)' },
          '50%': { transform: 'translateY(-10px) rotate(1.5deg)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        radar: {
          '0%': { transform: 'scale(0.95)', opacity: '0.8' },
          '100%': { transform: 'scale(2.2)', opacity: '0' },
        }
      }
    },
  },
  plugins: [],
}
