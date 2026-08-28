export default defineNuxtConfig({
  compatibilityDate: '2026-08-27',
  devtools: { enabled: true },
  // HU-ERD-21: Tailwind CSS + tema por defecto.
  modules: ['@nuxtjs/tailwindcss'],
  tailwindcss: {
    cssPath: '~/assets/css/main.css',
    configPath: 'tailwind.config.ts'
  },
  runtimeConfig: {
    databaseUrl: process.env.DATABASE_URL,
    jwtSecret: process.env.JWT_SECRET,
    public: {
      appMode: process.env.APP_MODE || 'saas'
    }
  }
})
