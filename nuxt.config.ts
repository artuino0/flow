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
      // HU-ERD-35: appMode y featureFlags NO viven aca a proposito. Este
      // bloque se resuelve UNA VEZ cuando corre `nuxt build` y queda horneado
      // en el output - levantar el server compilado con otro valor de
      // APP_MODE/FEATURE_DASHBOARD despues NO lo actualiza (Nuxt solo permite
      // sobreescribir runtimeConfig.public en runtime con su propia
      // convencion NUXT_PUBLIC_<CLAVE>, no con los nombres de variable que usa
      // el resto del proyecto) - se descubrio este comportamiento validando
      // esta misma HU con un e2e real. Ver GET /api/config y
      // composables/useDeploymentConfig.ts: se calculan frescos en cada request.
      //
      // Reservado para theming real - documentado en .env.example, todavia
      // sin aplicar a la UI. Baked-at-build esta bien aca porque nada depende
      // de que cambie sin rebuild (a diferencia de appMode/featureFlags).
      brand: {
        primaryColor: process.env.APP_BRAND_PRIMARY_COLOR || '',
        logoUrl: process.env.APP_BRAND_LOGO_URL || ''
      }
    }
  }
})
