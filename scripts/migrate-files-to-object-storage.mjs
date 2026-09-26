import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import postgres from 'postgres'
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3'

const dryRun = process.argv.includes('--dry-run')
const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('Configura DATABASE_URL con acceso administrativo a la base de datos')
const driver = (process.env.STORAGE_DRIVER || 'local').toLowerCase()
if (!['local', 'r2'].includes(driver)) throw new Error('STORAGE_DRIVER debe ser local o r2')

const root = path.resolve(process.env.FILES_STORAGE_DIR || path.join(process.cwd(), 'uploads'))
const sql = postgres(databaseUrl, { max: 1 })
let r2
let bucket
if (driver === 'r2') {
  const { R2_ACCOUNT_ID: accountId, R2_ACCESS_KEY_ID: accessKeyId, R2_SECRET_ACCESS_KEY: secretAccessKey, R2_BUCKET_NAME } = process.env
  if (!accountId || !accessKeyId || !secretAccessKey || !R2_BUCKET_NAME) throw new Error('Falta configurar R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY o R2_BUCKET_NAME')
  r2 = new S3Client({ region: 'auto', endpoint: `https://${accountId}.r2.cloudflarestorage.com`, credentials: { accessKeyId, secretAccessKey } })
  bucket = R2_BUCKET_NAME
}

function normalizedKey(key) {
  const normalized = key.replaceAll('\\', '/')
  if (!normalized || normalized.startsWith('/') || normalized.split('/').includes('..')) throw new Error(`Clave local no válida: ${key}`)
  return normalized
}
function safeName(name) { return path.basename(name).replace(/[^a-zA-Z0-9._-]/g, '_').slice(-100) || 'archivo' }
function encryptCsdKey(buffer) {
  const configured = process.env.SETTINGS_ENCRYPTION_KEY || process.env.JWT_SECRET
  if (!configured) throw new Error('Falta SETTINGS_ENCRYPTION_KEY (o JWT_SECRET compatible) para migrar llaves privadas CSD cifradas')
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', crypto.createHash('sha256').update(configured).digest(), iv)
  const encrypted = Buffer.concat([cipher.update(buffer.toString('base64'), 'utf8'), cipher.final()])
  return Buffer.from(['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.'))
}
async function migrate(sourceKey, targetKey, update, transform = value => value) {
  sourceKey = normalizedKey(sourceKey)
  targetKey = normalizedKey(targetKey)
  if (sourceKey === targetKey) return 'ya migrado'
  const sourcePath = path.join(root, ...sourceKey.split('/'))
  let body
  try { body = await fs.readFile(sourcePath) } catch (error) {
    if (error.code === 'ENOENT') throw new Error(`No se encuentra el archivo local ${sourcePath}`)
    throw error
  }
  if (dryRun) return `copiaría ${sourceKey} -> ${targetKey}`
  body = transform(body)
  if (driver === 'local') {
    const targetPath = path.join(root, ...targetKey.split('/'))
    await fs.mkdir(path.dirname(targetPath), { recursive: true })
    await fs.writeFile(targetPath, body)
  } else {
    await r2.send(new PutObjectCommand({ Bucket: bucket, Key: targetKey, Body: body }))
  }
  await update(targetKey)
  return `migrado ${sourceKey} -> ${targetKey}`
}

let count = 0
try {
  const fileRows = await sql`select id, tenant_id, storage_key, file_name from files order by tenant_id, id`
  for (const row of fileRows) {
    if (String(row.storage_key).replaceAll('\\', '/').startsWith(`tenants/${row.tenant_id}/files/`)) continue
    const target = `tenants/${row.tenant_id}/files/${row.id}-${safeName(row.file_name)}`
    console.log(await migrate(row.storage_key, target, key => sql`update files set storage_key = ${key} where id = ${row.id} and tenant_id = ${row.tenant_id}`))
    count++
  }

  const csdRows = await sql`select tenant_id, csd_cer_storage_key, csd_key_storage_key, csd_cer_file_name, csd_key_file_name from tenant_pac_settings where csd_cer_storage_key is not null or csd_key_storage_key is not null order by tenant_id`
  for (const row of csdRows) {
    const updates = {}
    for (const [column, fileNameColumn, prop] of [['csd_cer_storage_key', 'csd_cer_file_name', 'cer'], ['csd_key_storage_key', 'csd_key_file_name', 'key']]) {
      const oldKey = row[column]
      if (!oldKey || String(oldKey).replaceAll('\\', '/').startsWith(`tenants/${row.tenant_id}/csd/`)) continue
      const target = `tenants/${row.tenant_id}/csd/${safeName(row[fileNameColumn] || path.basename(oldKey))}`
      console.log(await migrate(oldKey, target, async key => { updates[column] = key }, prop === 'key' ? encryptCsdKey : undefined))
      count++
    }
    if (Object.keys(updates).length && !dryRun) await sql`update tenant_pac_settings set ${sql(updates)} where tenant_id = ${row.tenant_id}`
  }

  const cfdiRows = await sql`select id, tenant_id, xml_storage_key, pdf_storage_key from cfdi_documents where xml_storage_key is not null or pdf_storage_key is not null order by tenant_id, id`
  for (const row of cfdiRows) {
    const updates = {}
    for (const [column, kind] of [['xml_storage_key', 'xml'], ['pdf_storage_key', 'pdf']]) {
      const oldKey = row[column]
      if (!oldKey || String(oldKey).replaceAll('\\', '/').startsWith(`tenants/${row.tenant_id}/cfdi/`)) continue
      const target = `tenants/${row.tenant_id}/cfdi/${row.id}.${kind}`
      console.log(await migrate(oldKey, target, async key => { updates[column] = key }))
      count++
    }
    if (Object.keys(updates).length && !dryRun) await sql`update cfdi_documents set ${sql(updates)} where id = ${row.id} and tenant_id = ${row.tenant_id}`
  }
  console.log(`${dryRun ? 'Dry run' : 'Migración'}: ${count} archivos inspeccionados`)
} finally {
  await sql.end()
  if (r2) r2.destroy()
}
