import { randomUUID, X509Certificate } from 'node:crypto'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { withTenant } from '~/server/db'
import { tenantPacSettings } from '~/server/db/schema'
import { encryptSetting, decryptSetting } from '~/server/utils/settingsCrypto'
import { deleteStoredObject, getStoredObject, putStoredObject } from '~/server/utils/objectStorage'

// Fase B de DOCS/HU_Timbrado_CFDI_PAC.md: credenciales PAC por tenant.
// Secretos (API key, contraseña del CSD) SIEMPRE cifrados con settingsCrypto
// (AES-256-GCM, SETTINGS_ENCRYPTION_KEY) - mismo patron que tenant_email_
// settings (HU-ERD-84/migracion 0043). Los binarios .cer/.key van a disco con
// el patron de tenantLogo.ts (FILES_STORAGE_DIR/{tenantId}/...), NO por la
// tabla files: files exige entity_id de un modulo dinamico y el CSD es un dato
// del tenant (inmutabilidad fiscal: no pertenece a un modulo editable).
// NUNCA loggear apiKey/csdPassword ni devolverlos por API (solo flags
// hasApiKey/hasCsd, patron hasLogo de ERD-62).
//
// OJO: tenant_pac_settings tiene RLS FORCE (migracion 0049) - todo acceso por
// withTenant(), nunca con `db` pelado (sin el GUC app.tenant_id las policies
// ocultan todas las filas y el select devolveria null silenciosamente).

const MAX_CSD_SIZE_BYTES = 100 * 1024 // los CSD reales pesan ~2-5 KB; 100 KB es techo de sobra

export class PacNotConfiguredError extends Error {}
export class CsdInvalidError extends Error {}

// Mismo saneo que tenantLogo.ts/fileStorage.ts (duplicado a proposito, ver
// comentario alla: 2 lineas no justifican romper el aislamiento del util).
function sanitizeForDisk(fileName: string, fallback: string): string {
  const base = path.basename(fileName)
  return base.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-100) || fallback
}

export interface PacSummary {
  provider: string
  sandbox: boolean
  hasApiKey: boolean
  hasCsd: boolean
  csdCerFileName: string | null
  csdKeyFileName: string | null
  csdValidUntil: Date | string | null
  lastTestAt: Date | string | null
  lastTestOk: boolean | null
}

/** Vista publica (GET /api/tenant/pac): flags y metadatos, NUNCA secretos. */
export async function getPacSummary(tenantId: string): Promise<PacSummary | null> {
  return withTenant(tenantId, async (tx) => {
    const [row] = await tx.select().from(tenantPacSettings).where(eq(tenantPacSettings.tenantId, tenantId)).limit(1)
    if (!row) return null
    return {
      provider: row.provider,
      sandbox: row.sandbox,
      hasApiKey: row.apiKeyEncrypted != null,
      hasCsd: row.csdCerStorageKey != null && row.csdKeyStorageKey != null,
      csdCerFileName: row.csdCerFileName,
      csdKeyFileName: row.csdKeyFileName,
      csdValidUntil: row.csdValidUntil,
      lastTestAt: row.lastTestAt,
      lastTestOk: row.lastTestOk
    }
  })
}

export interface FullPacSettings {
  provider: string
  apiKey: string
  sandbox: boolean
  csdPassword: string | null
  csdCerStorageKey: string | null
  csdKeyStorageKey: string | null
}

/**
 * Configuracion completa DESCIFRADA - solo para consumo interno del servidor
 * (getPacProvider, prueba de conexion). Jamas serializar este objeto a una
 * respuesta HTTP ni a logs.
 */
export async function getFullPacSettings(tenantId: string): Promise<FullPacSettings> {
  return withTenant(tenantId, async (tx) => {
    const [row] = await tx.select().from(tenantPacSettings).where(eq(tenantPacSettings.tenantId, tenantId)).limit(1)
    if (!row) {
      throw new PacNotConfiguredError('La facturación no está configurada para esta organización')
    }
    // El laboratorio local ('lab') simula el timbrado sin servicio externo:
    // no necesita API key ni CSD (pedido del usuario, 2026-09-15). Cualquier
    // otro proveedor exige su key cifrada.
    if (row.provider !== 'lab' && !row.apiKeyEncrypted) {
      throw new PacNotConfiguredError('La facturación no está configurada para esta organización')
    }
    return {
      provider: row.provider,
      apiKey: row.apiKeyEncrypted ? decryptSetting(row.apiKeyEncrypted) : '',
      sandbox: row.sandbox,
      csdPassword: row.csdPasswordEncrypted ? decryptSetting(row.csdPasswordEncrypted) : null,
      csdCerStorageKey: row.csdCerStorageKey,
      csdKeyStorageKey: row.csdKeyStorageKey
    }
  })
}

export interface UpsertPacInput {
  provider?: 'facturapi' | 'lab'
  apiKey?: string
  sandbox?: boolean
  csdPassword?: string
}

/**
 * Crea/actualiza la configuracion. apiKey/csdPassword ausentes CONSERVAN el
 * secreto existente (mismo contrato que password en settings/email.put.ts:
 * el input type=password de la UI nunca devuelve el valor guardado).
 * Elegir el laboratorio local fuerza sandbox=true (el provider 'lab' nunca
 * funciona en modo produccion - ver getPacProvider).
 */
export async function upsertPacSettings(tenantId: string, userId: string | null, input: UpsertPacInput): Promise<void> {
  await withTenant(tenantId, async (tx) => {
    const [existing] = await tx.select().from(tenantPacSettings).where(eq(tenantPacSettings.tenantId, tenantId)).limit(1)
    const provider = input.provider ?? existing?.provider ?? 'facturapi'
    const values = {
      tenantId,
      provider,
      apiKeyEncrypted: input.apiKey ? encryptSetting(input.apiKey.trim()) : existing?.apiKeyEncrypted ?? null,
      sandbox: provider === 'lab' ? true : input.sandbox ?? existing?.sandbox ?? true,
      csdPasswordEncrypted: input.csdPassword ? encryptSetting(input.csdPassword) : existing?.csdPasswordEncrypted ?? null,
      updatedAt: new Date()
    }
    if (existing) {
      await tx.update(tenantPacSettings).set(values).where(eq(tenantPacSettings.id, existing.id))
    } else {
      await tx.insert(tenantPacSettings).values({ ...values, createdBy: userId })
    }
  })
}

// Best-effort: el .cer de un CSD es X.509 (DER o PEM); si Node no lo parsea
// (archivo corrupto, formato inesperado) no bloqueamos el alta - la fecha es
// informativa y la prueba de conexion (fase D) es la validacion real.
function parseCerValidUntil(buffer: Buffer): Date | null {
  try {
    return new Date(new X509Certificate(buffer).validTo)
  } catch {
    return null
  }
}

export interface CsdFileInput {
  fileName: string
  buffer: Buffer
}

/**
 * Guarda el par .cer/.key en disco (reemplaza y borra el anterior) y registra
 * storage keys + nombres + vigencia parseada del .cer. Validaciones: extension
 * por nombre de archivo y techo de tamaño. La contraseña del .key se cifra por
 * separado via upsertPacSettings(csdPassword).
 */
export async function storeCsdFiles(tenantId: string, cer: CsdFileInput, key: CsdFileInput): Promise<void> {
  if (!cer.fileName.toLowerCase().endsWith('.cer')) throw new CsdInvalidError('El certificado debe ser un archivo .cer')
  if (!key.fileName.toLowerCase().endsWith('.key')) throw new CsdInvalidError('La llave privada debe ser un archivo .key')
  for (const file of [cer, key]) {
    if (file.buffer.length === 0) throw new CsdInvalidError('El archivo está vacío')
    if (file.buffer.length > MAX_CSD_SIZE_BYTES) throw new CsdInvalidError('Cada archivo del CSD debe pesar menos de 100 KB')
  }

  const cerKey = `tenants/${tenantId}/csd/${randomUUID()}-${sanitizeForDisk(cer.fileName, 'csd.cer')}`
  const keyKey = `tenants/${tenantId}/csd/${randomUUID()}-${sanitizeForDisk(key.fileName, 'csd.key')}`

  const previous = await withTenant(tenantId, async (tx) => {
    const [row] = await tx.select({ cer: tenantPacSettings.csdCerStorageKey, key: tenantPacSettings.csdKeyStorageKey }).from(tenantPacSettings).where(eq(tenantPacSettings.tenantId, tenantId)).limit(1)
    if (!row) throw new PacNotConfiguredError('Guarda la API key del PAC antes de subir el certificado')
    await putStoredObject({ key: cerKey, body: cer.buffer, contentType: 'application/pkix-cert' })
    await putStoredObject({ key: keyKey, body: Buffer.from(encryptSetting(key.buffer.toString('base64'))), contentType: 'application/octet-stream' })
    await tx
      .update(tenantPacSettings)
      .set({
        csdCerStorageKey: cerKey,
        csdKeyStorageKey: keyKey,
        csdCerFileName: cer.fileName,
        csdKeyFileName: key.fileName,
        csdValidUntil: parseCerValidUntil(cer.buffer),
        updatedAt: new Date()
      })
      .where(eq(tenantPacSettings.tenantId, tenantId))
    return row
  })

  if (previous.cer) await deleteStoredObject(previous.cer.replaceAll('\\', '/'))
  if (previous.key) await deleteStoredObject(previous.key.replaceAll('\\', '/'))
}

/** Lee la llave privada CSD descifrándola solo en memoria para uso interno. */
export async function readCsdPrivateKey(tenantId: string): Promise<Buffer | null> {
  return withTenant(tenantId, async (tx) => {
    const [row] = await tx.select({ key: tenantPacSettings.csdKeyStorageKey }).from(tenantPacSettings).where(eq(tenantPacSettings.tenantId, tenantId)).limit(1)
    if (!row?.key) return null
    const stored = await getStoredObject(row.key.replaceAll('\\', '/'))
    return Buffer.from(decryptSetting(stored.toString('utf8')), 'base64')
  })
}

/** Borra el CSD (archivos + columnas). Idempotente: false si no habia. */
export async function deleteCsdFiles(tenantId: string): Promise<boolean> {
  return withTenant(tenantId, async (tx) => {
    const [row] = await tx.select({ cer: tenantPacSettings.csdCerStorageKey, key: tenantPacSettings.csdKeyStorageKey }).from(tenantPacSettings).where(eq(tenantPacSettings.tenantId, tenantId)).limit(1)
    if (!row?.cer && !row?.key) return false
    await tx
      .update(tenantPacSettings)
      .set({ csdCerStorageKey: null, csdKeyStorageKey: null, csdCerFileName: null, csdKeyFileName: null, csdValidUntil: null, updatedAt: new Date() })
      .where(eq(tenantPacSettings.tenantId, tenantId))
    if (row.cer) await deleteStoredObject(row.cer.replaceAll('\\', '/'))
    if (row.key) await deleteStoredObject(row.key.replaceAll('\\', '/'))
    return true
  })
}

/** Resultado de la prueba de conexion (POST /api/tenant/pac/test). */
export async function recordPacTest(tenantId: string, ok: boolean): Promise<void> {
  await withTenant(tenantId, async (tx) => {
    await tx
      .update(tenantPacSettings)
      .set({ lastTestAt: new Date(), lastTestOk: ok, updatedAt: new Date() })
      .where(eq(tenantPacSettings.tenantId, tenantId))
  })
}
