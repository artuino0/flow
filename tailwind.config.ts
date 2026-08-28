import type { Config } from 'tailwindcss'

// HU-ERD-21: tema por defecto. Paleta "primary" reutilizada en header/sidebar
// y en los componentes de Form/Table Builder (ERD-23/24).
export default <Partial<Config>>{
  content: [
    './app.vue',
    './layouts/**/*.vue',
    './pages/**/*.vue',
    './components/**/*.vue'
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          300: '#93c5fd',
          400: '#60a5fa',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
          800: '#1e40af',
          900: '#1e3a8a'
        }
      }
    }
  }
}
