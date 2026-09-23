export default defineNuxtConfig({
  compatibilityDate: '2026-08-27',
  devtools: { enabled: true },
  nitro: {
    experimental: { websocket: true },
    // La verificacion se incorpora al paquete on-premise durante el build.
    // Cambiar el .env del cliente no desactiva la licencia de ese paquete.
    replace: {
      __FLOWERP_ONPREM_BUILD__: process.env.FLOWERP_DISTRIBUTION === 'onprem' ? 'true' : 'false'
    }
  },
  // HU-ERD-21: Tailwind CSS + tema por defecto.
  modules: ['@nuxtjs/tailwindcss'],
  tailwindcss: {
    cssPath: '~/assets/css/main.css',
    configPath: 'tailwind.config.ts'
  },
  // Tipografia del diseno en Pencil (ERPDinamico.pen): Inter en todas las
  // pantallas. Cargada por link, no next/font (proyecto es Nuxt).
  //
  // Titulo de pestana y favicon (rebranding ERP Dinamico -> FlowERP, pedido
  // del usuario: "cambio de branding, todo donde diga ERP Dinamico cambia
  // Flow ERP checa Brand / FlowERP"). El favicon es un export PNG real del
  // nodo "FlowERP / Favicon 32" del brand kit en ERPDinamico.pen (Export()
  // via MCP de Pencil - no hay forma de sacar el d= de los paths SVG desde
  // esa API, solo rasterizar - ver tambien public/brand/*.png, usados en
  // layouts/default.vue y las pantallas de login/registro/invitacion).
  //
  // Lora (2026-09-11): la hoja impresa del reporte (Screen/Reporte - Vista
  // previa, tCiL7 en el .pen) usa una serif deliberadamente distinta de la
  // Inter del resto de la app - el papel imita un documento formal/fiscal,
  // no una pantalla de la app. Se agrega como familia aparte, no un
  // reemplazo de Inter (components/PrintReportPage.vue/PrintReportSheet.vue
  // son los unicos consumidores).
  app: {
    head: {
      title: 'Flow',
      link: [
        { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
        { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' },
        { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Lora:ital,wght@0,400;0,500;0,600;0,700;1,400&display=swap' },
        { rel: 'icon', type: 'image/png', href: '/brand/favicon.png' }
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
