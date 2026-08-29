export default defineNuxtConfig({
  compatibilityDate: '2026-08-27',
  devtools: { enabled: true },
  // HU-ERD-21: Tailwind CSS + tema por defecto.
  modules: ['@nuxtjs/tailwindcss'],
  tailwindcss: {
    cssPath: '~/assets/css/main.css',
    configPath: 'tailwind.config.ts'
  },
  // Tipografia del diseno en Pencil (ERPDinamico.pen): Inter en todas las
  // pantallas. Cargada por link, no next/font (proyecto es Nuxt).
  app: {
    head: {
      link: [
        { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
        { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' },
        { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap' }
      ]
    }
  },
  runtimeConfig: {
    databaseUrl: process.env.DATABASE_URL,
    jwtSecret: process.env.JWT_SECRET,
    public: {
      appMode: process.env.APP_MODE || 'saas'
    }
  }
})
