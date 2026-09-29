import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import postgres from 'postgres'
import { randomUUID } from 'node:crypto'
import { createTestDb, type TestDb } from '../setup/testDb'
import type { getDashboardMetrics as GetDashboardMetrics } from '../../server/utils/dashboardMetrics'
import { withSystemRecordAccess } from '../../server/utils/recordActorContext'

// HU-ERD-31: prueba server/utils/dashboardMetrics.ts contra un Postgres real
// (embedded-postgres, misma infraestructura de HU-ERD-29) - no unit tests con
// datos falsos: se siembran filas reales en dim_cliente/dim_sucursal/
// fact_eventos/users para DOS tenants y se confirma que la agregacion suma
// bien Y que no cruza tenants (getDashboardMetrics usa withTenant() -> RLS
// real, HU-ERD-12).
//
// getDashboardMetrics() importa (transitivamente) server/db/index.ts, que
// abre su conexion a partir de APP_DATABASE_URL leido UNA vez al importarse
// el modulo. Por eso el import es dinamico (await import(...)) DESPUES de
// levantar el Postgres de test y setear la env var - un import estatico se
// resolveria antes de que exista testDb.appUrl.

const TENANT_A = randomUUID()
const TENANT_B = randomUUID()

let testDb: TestDb
let admin: postgres.Sql
let getDashboardMetrics: typeof GetDashboardMetrics

async function seedTenant(tenantId: string) {
  await admin`insert into tenants (id, name) values (${tenantId}, 'Tenant ' || ${tenantId})`

  // dim_cliente / dim_sucursal / users: RLS existe en las 3, pero se insertan
  // via la conexion admin (erp_admin, superusuario -> bypassea RLS, igual que
  // en test/setup/testDb.ts), asi que no hace falta set_config aca.
  await admin`insert into dim_cliente (tenant_id, nombre, email) values (${tenantId}, 'Cliente 1', 'c1@test.com'), (${tenantId}, 'Cliente 2', null)`
  await admin`insert into dim_sucursal (tenant_id, nombre, ciudad) values (${tenantId}, 'Sucursal 1', 'CDMX')`

  const [role] = await admin`insert into roles (tenant_id, name, is_system) values (${tenantId}, 'Administrador', true) returning id`
  const [activePerson] = await admin`insert into people (email, password_hash, full_name) values (${'activo+' + tenantId + '@test.com'}, 'hash', 'Activo') returning id`
  const [inactivePerson] = await admin`insert into people (email, password_hash, full_name) values (${'inactivo+' + tenantId + '@test.com'}, 'hash', 'Inactivo') returning id`
  await admin`
    insert into users (tenant_id, role_id, person_id, is_active)
    values
      (${tenantId}, ${role.id}, ${activePerson.id}, true),
      (${tenantId}, ${role.id}, ${inactivePerson.id}, false)
  `

  // dim_date + fact_eventos: dos fechas distintas, dentro y fuera de un rango
  // que los tests van a usar para probar el filtro.
  await admin`
    insert into dim_date (id, date, year, quarter, month, day, day_of_week, is_weekend)
    values
      (20260801, '2026-08-01', 2026, 3, 8, 1, 6, true),
      (20260815, '2026-08-15', 2026, 3, 8, 15, 6, true)
    on conflict (id) do nothing
  `
  await admin`
    insert into fact_eventos (tenant_id, date_id, tipo_evento, monto, cantidad)
    values
      (${tenantId}, 20260801, 'clientes', 100, 1),
      (${tenantId}, 20260801, 'clientes', 50, 2),
      (${tenantId}, 20260815, 'empresas', 200, 1)
  `
}

beforeAll(async () => {
  testDb = await createTestDb()
  admin = postgres(testDb.adminUrl)

  await seedTenant(TENANT_A)
  await seedTenant(TENANT_B)

  process.env.APP_DATABASE_URL = testDb.appUrl
  const { getDashboardMetrics: readMetrics } = await import('../../server/utils/dashboardMetrics')
  // Estas pruebas ejercitan la agregación entre tenants como proceso de sistema.
  getDashboardMetrics = (tenantId, options) => withSystemRecordAccess(() => readMetrics(tenantId, options))
}, 60_000)

afterAll(async () => {
  await admin.end()
  await testDb.stop()
})

describe('getDashboardMetrics (Postgres real)', () => {
  it('agrega correctamente eventos/clientes/sucursales/usuarios de un tenant', async () => {
    const metrics = await getDashboardMetrics(TENANT_A, {
      from: new Date('2026-08-01T00:00:00.000Z'),
      to: new Date('2026-08-31T00:00:00.000Z')
    })

    expect(metrics.tenantId).toBe(TENANT_A)
    expect(metrics.eventos.total).toBe(3)
    expect(metrics.eventos.montoTotal).toBe('350.00')
    expect(metrics.eventos.cantidadTotal).toBe(4)
    expect(metrics.eventos.porTipo).toEqual(
      expect.arrayContaining([
        { tipoEvento: 'clientes', total: 2, monto: '150.00' },
        { tipoEvento: 'empresas', total: 1, monto: '200.00' }
      ])
    )
    expect(metrics.clientes.total).toBe(2)
    expect(metrics.sucursales.total).toBe(1)
    expect(metrics.usuarios.total).toBe(2)
    expect(metrics.usuarios.activos).toBe(1)
  })

  it('filtra por rango de fechas (dim_date)', async () => {
    const metrics = await getDashboardMetrics(TENANT_A, {
      from: new Date('2026-08-01T00:00:00.000Z'),
      to: new Date('2026-08-10T00:00:00.000Z')
    })

    expect(metrics.eventos.total).toBe(2)
    expect(metrics.eventos.montoTotal).toBe('150.00')
    expect(metrics.eventos.porTipo).toEqual([{ tipoEvento: 'clientes', total: 2, monto: '150.00' }])
  })

  it('filtra por tipoEvento', async () => {
    const metrics = await getDashboardMetrics(TENANT_A, {
      from: new Date('2026-08-01T00:00:00.000Z'),
      to: new Date('2026-08-31T00:00:00.000Z'),
      tipoEvento: 'empresas'
    })

    expect(metrics.eventos.total).toBe(1)
    expect(metrics.eventos.montoTotal).toBe('200.00')
  })

  it('nunca mezcla datos entre tenants (RLS real via withTenant)', async () => {
    const metricsA = await getDashboardMetrics(TENANT_A, {
      from: new Date('2026-08-01T00:00:00.000Z'),
      to: new Date('2026-08-31T00:00:00.000Z')
    })
    const metricsB = await getDashboardMetrics(TENANT_B, {
      from: new Date('2026-08-01T00:00:00.000Z'),
      to: new Date('2026-08-31T00:00:00.000Z')
    })

    // Cada tenant sembro exactamente los mismos datos (ver seedTenant) - si
    // hubiera fuga entre tenants, alguno de estos totales aparaceria doblado.
    expect(metricsA.eventos.total).toBe(3)
    expect(metricsB.eventos.total).toBe(3)
    expect(metricsA.clientes.total).toBe(2)
    expect(metricsB.clientes.total).toBe(2)
  })

  it('usa un rango default de 30 dias cuando no se pasan from/to', async () => {
    const metrics = await getDashboardMetrics(TENANT_A, {})
    // Sin from/to explicitos, el rango cae muy lejos de las fechas sembradas
    // (2026-08-01/15), asi que no deberia contar nada - solo confirma que el
    // default no explota y no revienta el conteo de clientes/sucursales/
    // usuarios (que no dependen del rango de fechas).
    expect(metrics.clientes.total).toBe(2)
    expect(metrics.sucursales.total).toBe(1)
    expect(metrics.usuarios.total).toBe(2)
  })
})
