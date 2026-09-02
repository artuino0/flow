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
          'sidebar-active-bg': '#EAF0F6',
          'success-bg': '#CCF1DE',
          'success-text': '#0A7A4F',
          'warning-bg': '#FEF0D2',
          'warning-text': '#B3720A',
          'error-bg': '#FBE0DD',
          'error-text': '#C7391F',
          'info-bg': '#E5F5F8',
          'info-text': '#0091AE',
          'neutral-bg': '#EAF0F6',
          'neutral-text': '#516F90',
          'purple-bg': '#EDE7FB',
          'purple-text': '#6D3FC4',
          'pink-bg': '#FCE4EF',
          'pink-text': '#C42B7A',
          // Pedido por el usuario (2026-09-01): badge "UUID" del campo "id"
          // reservado (components/ModuleFieldsCard.vue) - dorado, distinto
          // del amber/naranja ya usado por "warning" (booleano).
          'gold-bg': '#FBF3D9',
          'gold-text': '#8C6D14',
          // HU-ERD-78: badge del dataType "Archivo" (ModuleFieldsCard.vue) -
          // todos los demas pares de color ya estaban tomados por otro tipo
          // de dato (error-bg/error-text quedan reservados para estados de
          // error de verdad en toda la app, nunca se reusan como badge).
          'indigo-bg': '#E0E7FF',
          'indigo-text': '#4338CA'
        }
      }
    }
  }
}
