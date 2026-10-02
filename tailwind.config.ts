import { brandColors } from './utils/themeTokens'
import type { Config } from 'tailwindcss'

// HU-ERD-21: tema por defecto. Paleta "primary" original de bootstrap, ya
// reemplazada en la practica por "brand" (ver mas abajo) en todas las
// pantallas autenticadas - se deja definida por compatibilidad, no se borra
// para no romper clases sueltas que puedan quedar referenciandola.
//
// "brand": paleta extraida de las variables del diseno en Pencil
// (ERPDinamico.pen). Aplicada primero solo a pages/login.vue; extendida a
// todo el proyecto (layout, sidebar, tablas, formularios, dashboard, roles)
// para que la app completa siga el mismo sistema visual, no solo el login.
// Los nombres de color coinciden 1:1 con las variables del .pen
// (bg/surface/border/border-light/text-primary/etc) para que sea facil
// contrastar contra el archivo de diseno.
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
        brand: brandColors
      }
    }
  }
}
