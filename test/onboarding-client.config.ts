import { defineConfig } from 'vitest/config'
import config from '../vitest.config'

// Ejecuta la infraestructura real con las banderas del cliente de Nuxt,
// sin cambiar el entorno de las pruebas unitarias existentes ni usar navegador.
export default defineConfig({
  ...config,
  define: { 'import.meta.client': 'true', 'import.meta.dev': 'false' },
  test: { ...config.test, include: ['test/unit/onboarding.client.ts'] }
})
