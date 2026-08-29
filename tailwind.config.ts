import type { Config } from 'tailwindcss'

// HU-ERD-21: tema por defecto. Paleta "primary" reutilizada en header/sidebar
// y en los componentes de Form/Table Builder (ERD-23/24).
//
// "brand": paleta extraida de las variables del diseno en Pencil
// (ERPDinamico.pen), aplicada por ahora solo en pages/login.vue. Se agrega
// como grupo nuevo (no se pisa "primary") para no re-tematizar header/sidebar
// sin haberlo pedido explicitamente.
export default <Partial<Config>>{
  content: [
    './app.vue',
    './layouts/**/*.vue',
    './pages/**/*.vue',
    './components/**/*.vue'
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif']
      },
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
        },
        brand: {
          bg: '#F5F8FA',
          surface: '#FFFFFF',
          border: '#CBD6E2',
          'border-light': '#E5EAF0',
          text: '#33475B',
          'text-secondary': '#516F90',
          'text-muted': '#8DA1B5',
          orange: '#FF7A59',
          'orange-hover': '#E66E50',
          blue: '#0091AE',
          'blue-bg': '#EAF3F6',
          navy: '#213343',
          'error-bg': '#FBE0DD',
          'error-text': '#C7391F'
        }
      }
    }
  }
}
