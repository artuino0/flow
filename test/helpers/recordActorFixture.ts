import type postgres from 'postgres'
import { randomUUID } from 'node:crypto'
import { withRecordActor } from '../../server/utils/recordActorContext'

/** Identidad administrativa real para utilidades que en HTTP reciben auth de Nitro. */
export async function withFixtureAdmin<T>(tenantId: string, admin: postgres.Sql, run: () => Promise<T>): Promise<T> {
  const [role] = await admin`insert into roles (tenant_id, name, is_system) values (${tenantId}, ${`Fixture ${randomUUID()}`}, true) returning id`
  const [person] = await admin`insert into people (email, password_hash, full_name) values (${`${randomUUID()}@fixture.local`}, 'fixture', 'Actor de prueba') returning id`
  const [user] = await admin`insert into users (tenant_id, role_id, person_id) values (${tenantId}, ${role!.id}, ${person!.id}) returning id`
  return withRecordActor({ userId: user!.id, roleId: role!.id }, run)
}

export function adminRecordTest(tenantId: () => string, admin: () => postgres.Sql, run: () => Promise<void>): () => Promise<void> {
  return () => withFixtureAdmin(tenantId(), admin(), run)
}
