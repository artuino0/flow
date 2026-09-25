import { defineConfig } from 'vitest/config'
import path from 'node:path'

// HU-ERD-29: config minima de Vitest. Sin plugin de Nuxt/Vue (estos tests son
// solo de server/utils - logica pura + acceso a Postgres), asi que no hace
// falta el entorno completo de @nuxt/test-utils. Se resuelve el alias "~" a
// mano (mismo alias que usa Nuxt/Nitro) porque server/utils/*.ts lo usa
// internamente (ej. dynamicSchema.ts importa "~/server/db"), aunque el
// codigo bajo test en si no toque la base de datos.
export default defineConfig({
  resolve: {
    alias: {
      '~': path.resolve(__dirname, '.')
    }
  },
  test: {
    environment: 'node',
    // Los cachés de vida corta (sesión, permisos, metadatos) se apagan en las pruebas: muchas
    // cambian permisos o sesiones con SQL directo y esperan verlo al instante. Las pruebas de
    // los cachés los encienden a propósito.
    env: { SESSION_CACHE_TTL_MS: '0', ACCESS_CACHE_TTL_MS: '0', METADATA_CACHE_TTL_MS: '0' },
    include: ['test/**/*.test.ts'],
    // El test de integracion (HU-ERD-29) levanta un Postgres real embebido
    // (embedded-postgres) y corre las migraciones - mas lento que un test
    // unitario comun.
    testTimeout: 30000,
    hookTimeout: 30000
  }
})
