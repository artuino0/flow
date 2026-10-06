import { createHmac, timingSafeEqual } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { sql } from 'drizzle-orm'
import { createError } from 'h3'
import { withTenantRecovery } from '~/server/db'
import { deleteStoredObject, getStoredObject, putStoredObject } from './objectStorage'
import { getAccountObject } from './accountStorage'
import { accountObjectKey, ownAccountObject } from './accountObjectKey'
import { withSystemRecordAccess } from './recordActorContext'
import type { ClaimedJob, JobOutcome } from './jobQueue'

export const ACCOUNT_EXPORT_LIMIT = 100 * 1024 * 1024
const INDEX_RESERVE = 1024 * 1024
const omittedTables = new Set(['auth_sessions', 'api_keys', 'webhook_configs', 'tenant_pac_settings', 'account_exports', 'account_deletion_items', 'job_queue', 'account_notices'])
const omittedColumns = new Set(['password_hash', 'totp_secret', 'totp_pending_secret', 'totp_backup_codes', 'token_hash', 'invitation_token_hash', 'refresh_token_hash', 'secret', 'access_token', 'refresh_token', 'registration_intent'])
/** Un nombre de archivo generado por el servidor, independiente de títulos del cliente. */
function tarEntry(name: string, body: Buffer) {
  if (!/^[a-zA-Z0-9_./-]{1,99}$/.test(name) || name.includes('..')) throw new Error('Nombre de exportación inválido')
  const header = Buffer.alloc(512)
  header.write(name, 0); header.write('0000644\0', 100); header.write('0000000\0', 108); header.write('0000000\0', 116)
  header.write(body.length.toString(8).padStart(11, '0') + '\0', 124); header.write('00000000000\0', 136)
  header.fill(32, 148, 156); header[156] = 48; header.write('ustar\0', 257); header.write('00', 263)
  const sum = header.reduce((total, value) => total + value, 0)
  header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148)
  return Buffer.concat([header, body, Buffer.alloc((512 - body.length % 512) % 512)])
}
export function accountExportSignature(tenantId: string, id: string, expires: string) {
  const secret = process.env.JWT_SECRET
  if (!secret) throw new Error('Falta la clave de firma de la aplicación')
  return createHmac('sha256', secret).update(`account-export:${tenantId}:${id}:${expires}`).digest('hex')
}
export async function requestAccountExport(tenantId: string, now = new Date()) {
  return withTenantRecovery(tenantId, async tx => {
    const [tenant] = await tx.execute(sql`select account_lifecycle from tenants where id=${tenantId}::uuid for update`)
    if (!tenant || (tenant.account_lifecycle as Record<string, unknown>).deletionStarted) throw createError({ statusCode: 409, statusMessage: 'El borrado ya comenzó.' })
    const [running] = await tx.execute(sql`select id from account_exports where tenant_id=${tenantId}::uuid and status='pending' and expires_at>${now.toISOString()}::timestamptz limit 1`)
    if (running) return { id: String(running.id) }
    const [row] = await tx.execute(sql`insert into account_exports(tenant_id,expires_at) values (${tenantId}::uuid,${new Date(now.getTime() + 86400000).toISOString()}::timestamptz) returning id`)
    await tx.execute(sql`insert into job_queue(tenant_id,kind,payload,idempotency_key) values (${tenantId}::uuid,'account_export',${JSON.stringify({ exportId: row!.id })}::jsonb,${'account-export:' + row!.id})`)
    return { id: String(row!.id) }
  })
}
export async function accountExports(tenantId: string) {
  return withTenantRecovery(tenantId, async tx => {
    const rows = await tx.execute(sql`select id,status,expires_at,error from account_exports where tenant_id=${tenantId}::uuid order by created_at desc limit 10`)
    return { exports: rows.map(row => {
      const id = String(row.id), expires = new Date(row.expires_at as string).toISOString()
      return { id, status: row.status, expiresAt: expires, error: row.error, url: row.status === 'ready' && Date.parse(expires) > Date.now() ? `/api/account/export/download?id=${id}&expires=${encodeURIComponent(expires)}&signature=${accountExportSignature(tenantId, id, expires)}` : null }
    }) }
  })
}
export async function handleAccountExport(job: ClaimedJob): Promise<JobOutcome> {
  const tenantId = job.tenantId
  if (!tenantId) return { ok: false, retryable: false, error: 'Trabajo sin organización inválido' }
  if (typeof job.payload.exportId !== 'string' || !/^[0-9a-f-]{36}$/i.test(job.payload.exportId)) return { ok: false, retryable: false, error: 'Exportación inválida' }
  const id = job.payload.exportId
  try {
    await withSystemRecordAccess(() => withTenantRecovery(tenantId, async tx => {
      await tx.execute(sql`set local statement_timeout='30000'`)
      const [owner] = await tx.execute(sql`select account_lifecycle from tenants where id=${tenantId}::uuid for update`)
      if (!owner || (owner.account_lifecycle as Record<string, unknown>).deletionStarted) throw new Error('El borrado ya comenzó')
      const [row] = await tx.execute(sql`select * from account_exports where id=${id}::uuid and tenant_id=${tenantId}::uuid for update`)
      if (!row || row.status !== 'pending') return
      if (new Date(row.expires_at as string).getTime() <= Date.now()) throw new Error('La solicitud caducó. Genera otra exportación.')
      const chunks: Buffer[] = [], entries: Array<{ path: string; bytes: number }> = [], storage = new Set<string>()
      const warnings: Array<{ storageKey: string; reason: string }> = []
      let bytes = 0
      const add = (name: string, body: Buffer) => {
        const entry = tarEntry(name, body)
        if (bytes + entry.length + 1024 > ACCOUNT_EXPORT_LIMIT - (name === 'indice.json' ? 0 : INDEX_RESERVE)) throw new Error('Los datos superan 100 MiB sin comprimir. Solicita una exportación asistida al equipo de Flow.')
        bytes += entry.length
        chunks.push(entry); entries.push({ path: name, bytes: body.length })
      }
      const tables = await tx.execute(sql`select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid and a.attname='tenant_id' and not a.attisdropped where n.nspname='public' and c.relkind='r' order by c.relname`)
      for (const table of tables) {
        const name = String(table.relname)
        if (omittedTables.has(name) || name === 'platform_crm_events' || name === 'records') continue
        // RLS y predicado explícito. Páginas limitadas por bytes; snapshot de la transacción.
        let offset = 0, page = 0
        while (true) {
          const records = await tx.execute(sql`select * from ${sql.identifier(name)} where tenant_id=${tenantId}::uuid order by ctid limit 500 offset ${offset}`)
          if (!records.length) break
          for (const record of records) for (const [key, value] of Object.entries(record)) if (key.endsWith('storage_key') && typeof value === 'string') storage.add(accountObjectKey(tenantId, name, value))
          const clean = records.map(record => Object.fromEntries(Object.entries(record).filter(([key]) => !omittedColumns.has(key) && !key.endsWith('_encrypted'))))
          add(`datos/${name}-${++page}.json`, Buffer.from(JSON.stringify(clean, null, 2)))
          offset += records.length
        }
      }
      // Tablas hijas sin tenant_id: predicado por sus padres, además de RLS.
      const children = [
        ['entity_fields', sql`entity_id in (select id from entities where tenant_id=${tenantId}::uuid)`],
        ['entity_field_history', sql`entity_field_id in (select f.id from entity_fields f join entities e on e.id=f.entity_id where e.tenant_id=${tenantId}::uuid)`],
        ['entity_field_counters', sql`entity_field_id in (select f.id from entity_fields f join entities e on e.id=f.entity_id where e.tenant_id=${tenantId}::uuid)`],
        ['role_entity_permissions', sql`role_id in (select id from roles where tenant_id=${tenantId}::uuid) and entity_id in (select id from entities where tenant_id=${tenantId}::uuid)`],
        ['notification_group_members', sql`group_id in (select id from notification_groups where tenant_id=${tenantId}::uuid) and user_id in (select id from users where tenant_id=${tenantId}::uuid)`]
      ] as const
      for (const [name, predicate] of children) {
        let offset = 0, page = 0
        while (true) {
          const rows = await tx.execute(sql`select * from ${sql.identifier(name)} where ${predicate} order by ctid limit 500 offset ${offset}`)
          if (!rows.length) break
          add(`datos/${name}-${++page}.json`, Buffer.from(JSON.stringify(rows, null, 2)))
          offset += rows.length
        }
      }
      const modules = await tx.execute(sql`select id,name,slug from entities where tenant_id=${tenantId}::uuid order by id`)
      for (const module of modules) {
        let offset = 0, page = 0
        while (true) {
          const records = await tx.execute(sql`select * from records where tenant_id=${tenantId}::uuid and entity_id=${String(module.id)}::uuid order by id limit 500 offset ${offset}`)
          if (!records.length) break
          add(`modulos/${module.id}-${++page}.json`, Buffer.from(JSON.stringify(records, null, 2)))
          offset += records.length
        }
      }
      const members = await tx.execute(sql`select p.id,p.email,p.full_name,p.phone from people p join users u on u.person_id=p.id where u.tenant_id=${tenantId}::uuid`)
      add('datos/personas.json', Buffer.from(JSON.stringify(members, null, 2)))
      const [tenant] = await tx.execute(sql`select * from tenants where id=${tenantId}::uuid`)
      if (typeof tenant?.logo_storage_key === 'string') storage.add(accountObjectKey(tenantId, 'tenants', tenant.logo_storage_key))
      add('datos/organizacion.json', Buffer.from(JSON.stringify(Object.fromEntries(Object.entries(tenant!).filter(([key]) => !omittedColumns.has(key) && !key.endsWith('_encrypted'))), null, 2)))
      const files: Array<{ storageKey: string; path: string }> = []
      let sequence = 0
      for (const key of storage) {
        if (!ownAccountObject(tenantId, key)) throw new Error('Un archivo necesita revisión de aislamiento. Solicita una exportación asistida.')
        let body: Buffer
        try { body = await getAccountObject(key) }
        catch { warnings.push({ storageKey: key, reason: 'Archivo no disponible; solicita su recuperación asistida a Flow.' }); continue }
        if (bytes + body.length + 1024 + 512 > ACCOUNT_EXPORT_LIMIT - INDEX_RESERVE) {
          warnings.push({ storageKey: key, reason: 'Adjunto omitido por el límite de 100 MiB; los registros se incluyen. Solicita los archivos mediante exportación asistida.' })
          continue
        }
        const extension = key.match(/\.[a-zA-Z0-9]{1,8}$/)?.[0] ?? '.bin'
        const name = `archivos/${++sequence}${extension}`
        add(name, body); files.push({ storageKey: key, path: name })
      }
      add('indice.json', Buffer.from(JSON.stringify({ format: 'Flow JSON + archivos / tar.gz', generatedAt: new Date().toISOString(), tenantId: tenantId, modules, entries, files, warnings, attachmentsComplete: warnings.length === 0, excludedTables: [...omittedTables], excludedColumns: [...omittedColumns], excludedColumnSuffix: '_encrypted', limitBytes: ACCOUNT_EXPORT_LIMIT }, null, 2)))
      const key = `tenants/${tenantId}/account-exports/${id}.tar.gz`
      await putStoredObject({ key, body: gzipSync(Buffer.concat([...chunks, Buffer.alloc(1024)])), contentType: 'application/gzip', cacheControl: 'no-store' })
      await tx.execute(sql`update account_exports set status='ready',storage_key=${key} where id=${id}::uuid`)
    }, { isolationLevel: 'repeatable read' }))
    return { ok: true }
  } catch {
    await withTenantRecovery(tenantId, tx => tx.execute(sql`update account_exports set status='failed',error='No se pudo completar la exportación. Puede superar 100 MiB o contener un archivo legado; solicita exportación asistida al equipo de Flow.' where id=${id}::uuid and status='pending'`))
    return { ok: false, retryable: false, error: 'Exportación fallida; genera otra solicitud o contacta a Flow.' }
  }
}
export async function downloadAccountExport(tenantId: string, id: string, expires: string, signature: string, now = new Date()) {
  const expected = accountExportSignature(tenantId, id, expires)
  if (!/^[0-9a-f]{64}$/.test(signature) || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) throw createError({ statusCode: 403, statusMessage: 'Enlace inválido.' })
  if (!Number.isFinite(Date.parse(expires)) || Date.parse(expires) <= now.getTime()) throw createError({ statusCode: 410, statusMessage: 'El enlace caducó. Genera otra exportación.' })
  const [row] = await withTenantRecovery(tenantId, tx => tx.execute(sql`select storage_key,expires_at from account_exports where id=${id}::uuid and tenant_id=${tenantId}::uuid and status='ready'`))
  if (!row || new Date(row.expires_at as string).toISOString() !== expires || !String(row.storage_key).startsWith(`tenants/${tenantId}/account-exports/`)) throw createError({ statusCode: 404, statusMessage: 'Exportación no encontrada.' })
  return getStoredObject(String(row.storage_key))
}

export async function cleanupExpiredAccountExports(tenantId: string, now = new Date()) {
  return withTenantRecovery(tenantId, async tx => {
    const rows = await tx.execute(sql`select id,storage_key from account_exports where tenant_id=${tenantId}::uuid and expires_at<=${now.toISOString()}::timestamptz and storage_key is not null order by expires_at limit 10 for update skip locked`)
    for (const row of rows) {
      const key = String(row.storage_key)
      if (!key.startsWith(`tenants/${tenantId}/account-exports/`)) throw new Error('Llave de exportación inválida')
      await deleteStoredObject(key)
      await tx.execute(sql`update account_exports set status='failed',storage_key=null,error='El enlace caducó. Genera otra exportación.' where id=${String(row.id)}::uuid`)
    }
  })
}
