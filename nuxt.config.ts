export default defineNuxtConfig({
  compatibilityDate: '2026-08-27',
  devtools: { enabled: true },
  runtimeConfig: {
    databaseUrl: process.env.DATABASE_URL,
    jwtSecret: process.env.JWT_SECRET,
    public: {
      appMode: process.env.APP_MODE || 'saas'
    }
  }
})
