import { afterAll, beforeAll, expect, it } from 'vitest'
import postgres from 'postgres'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createTestDb, type TestDb } from '../setup/testDb'

let fixture: TestDb, admin: postgres.Sql, owner: postgres.Sql
beforeAll(async () => {
  fixture = await createTestDb()
  admin = postgres(fixture.adminUrl, { max: 1, onnotice: () => {} })
  owner = postgres(fixture.ownerUrl, { max: 1, onnotice: () => {} })
}, 120_000)
afterAll(async () => {
  if (owner) await owner.end()
  if (admin) await admin.end()
  if (fixture) await fixture.stop()
})

it('recorre todas las migraciones con propietario NOSUPERUSER BYPASSRLS y erp_app sin privilegios', async () => {
  expect((await owner`select current_setting('is_superuser') as super`)[0]!.super).toBe('off')
  expect((await owner`select rolsuper, rolbypassrls from pg_roles where rolname = current_user`)[0]).toMatchObject({ rolsuper: false, rolbypassrls: true })
  expect((await owner`select rolsuper, rolbypassrls, rolcreatedb, rolcreaterole from pg_roles where rolname = 'erp_app'`)[0]).toMatchObject({ rolsuper: false, rolbypassrls: false, rolcreatedb: false, rolcreaterole: false })
  const functions = await owner`select proname, pg_get_userbyid(proowner) as owner, proconfig from pg_proc where proname like 'capture_platform_crm_%'`
  expect(functions).toHaveLength(4)
  for (const fn of functions) {
    expect(fn.owner).toBe('erp_owner')
    expect(fn.proconfig).not.toEqual(expect.arrayContaining([expect.stringMatching(/^(app|flow)\./)]))
  }
  // Sonda del mismo fallo 42501: transacción revertida, función nunca persistida.
  for (const setting of ['app.bug188_probe', 'flow.bug188_probe']) {
    await expect(owner.begin(async tx => {
      await tx.unsafe(`CREATE FUNCTION bug188_probe() RETURNS void LANGUAGE plpgsql SET ${setting} = 'on' AS $$ BEGIN NULL; END $$`)
    })).rejects.toMatchObject({ code: '42501' })
  }
})

it('0096 falla con 42501 al reintroducir solo SET app. en la cabecera y pasa al retirarlo', async () => {
  const previous = await createTestDb({ throughMigration: '0095_registration_intent.sql' })
  const migrator = postgres(previous.ownerUrl, { max: 1, onnotice: () => {} })
  try {
    const fixed = readFileSync(resolve(__dirname, '../../server/db/migrations/0096_platform_crm.sql'), 'utf8')
    const broken = fixed.replace('SECURITY DEFINER SET search_path = pg_catalog, public SET lock_timeout',
      "SECURITY DEFINER SET search_path = pg_catalog, public SET app.platform_crm_worker = 'on' SET lock_timeout")
    expect(broken).not.toBe(fixed)
    await expect(migrator.begin(async tx => { await tx.unsafe(broken) })).rejects.toMatchObject({ code: '42501' })
    expect((await migrator`select to_regclass('platform_crm_events') as table_name`)[0]!.table_name).toBeNull()
    await migrator.begin(async tx => { await tx.unsafe(fixed) })
    expect((await migrator`select to_regclass('platform_crm_events') as table_name`)[0]!.table_name).toBe('platform_crm_events')
  } finally {
    await migrator.end()
    await previous.stop()
  }
}, 120_000)

async function context(tx: postgres.TransactionSql) {
  const [settings] = await tx`select current_setting('app.tenant_id', true) as tenant,
    current_setting('app.person_id', true) as person, current_setting('app.platform_crm_worker', true) as worker`
  return settings!
}

// Cada caso usa una conexión nueva: distingue NULL inicial de placeholder vacío.
for (const prior of ['absent', 'empty', 'defined'] as const) {
  for (const failing of [false, true]) {
    it(`cada trigger restaura tenant/person/worker (${prior}, captura ${failing ? 'fallida' : 'correcta'}) incluso sin BYPASSRLS`, async () => {
      const tenant = randomUUID(), person = randomUUID(), role = randomUUID()
      await admin`insert into tenants (id, name, slug, email) values (${tenant}, 'Contexto 188', ${tenant}, 'negocio188@local.test')`
      await admin`insert into people (id, email, password_hash, full_name) values (${person}, ${`${person}@local.test`}, 'x', 'Propietario 188')`
      await admin`insert into roles (id, tenant_id, name, is_system) values (${role}, ${tenant}, 'Administrador', true)`
      await admin`insert into users (tenant_id, person_id, role_id) values (${tenant}, ${person}, ${role})`
      await admin`delete from platform_crm_events where tenant_id = ${tenant}`
      // Demuestra que el cuerpo proporciona el contexto RLS, sin depender de BYPASSRLS.
      await admin`alter role erp_owner nobypassrls`
      const caller = postgres(fixture.adminUrl, { max: 1, onnotice: () => {} })
      try {
        if (failing) await admin`alter table platform_crm_events rename to platform_crm_events_unavailable188`
        await caller.begin(async tx => {
          if (prior !== 'absent') {
            await tx`select set_config('app.tenant_id', ${prior === 'empty' ? '' : randomUUID()}, true),
              set_config('app.person_id', ${prior === 'empty' ? '' : randomUUID()}, true),
              set_config('app.platform_crm_worker', ${prior === 'empty' ? '' : 'caller188'}, true)`
          }
          const before = await context(tx)
          if (prior === 'absent') expect(before).toEqual({ tenant: null, person: null, worker: null })
          const check = async () => {
            const after = await context(tx)
            for (const key of ['tenant', 'person', 'worker']) {
              if (before[key] === null) expect([null, '']).toContain(after[key])
              else expect(after[key]).toBe(before[key])
            }
          }
          let previousGeneration: string | undefined
          const captured = async () => {
            await check()
            if (!failing) {
              const events = await tx`select generation from platform_crm_events where tenant_id = ${tenant}`
              expect(events).toHaveLength(1)
              expect(events[0]!.generation).not.toBe(previousGeneration)
              previousGeneration = events[0]!.generation
            }
          }
          const newTenant = randomUUID()
          await tx`insert into tenants (id, name, slug) values (${newTenant}, 'Alta 188', ${newTenant})`
          await check()
          if (!failing) expect(await tx`select tenant_id from platform_crm_events where tenant_id = ${newTenant}`).toHaveLength(1)
          await tx`update tenants set name = 'Cambio 188', registration_intent = '{"plan":"starter"}' where id = ${tenant}`
          await captured()
          await tx`insert into tenant_subscriptions (tenant_id, plan_id, provider, status) select ${tenant}, id, 'manual', 'active' from plans where key = 'starter'`
          await captured()
          await tx`update tenant_subscriptions set status = 'past_due' where tenant_id = ${tenant}`
          await captured()
          await tx`delete from tenant_subscriptions where tenant_id = ${tenant}`
          await captured()
          await tx`insert into tenant_billing_invoices (tenant_id, provider_invoice_id, status) values (${tenant}, ${randomUUID()}, 'paid')`
          await captured()
          await tx`update tenant_billing_invoices set status = 'open' where tenant_id = ${tenant}`
          await captured()
          await tx`insert into tenant_limit_overrides (tenant_id, concept, value, reason) values (${tenant}, 'users', 10, 'Prueba 188')`
          await captured()
          await tx`update tenant_limit_overrides set value = 11 where tenant_id = ${tenant}`
          await captured()
          await tx`delete from tenant_limit_overrides where tenant_id = ${tenant}`
          await captured()
          await tx`update plans set name = name where key = 'starter'`
          await captured()
          await tx`delete from tenants where id = ${tenant}`
          await captured()
          expect(await tx`select id from tenants where id = ${tenant}`).toHaveLength(0)
          if (!failing) {
            const [event] = await tx`select payload from platform_crm_events where tenant_id = ${tenant}`
            expect(event!.payload.deleted.correo).toBe(`${person}@local.test`)
          }
        })
      } finally {
        if (failing) await admin`alter table platform_crm_events_unavailable188 rename to platform_crm_events`
        await admin`alter role erp_owner bypassrls`
        await caller.end()
      }
    })
  }
}
