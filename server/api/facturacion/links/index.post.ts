import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { withTenant } from '~/server/db'
import { cfdiDocumentLinks, cfdiDocuments, records } from '~/server/db/schema'
import { requireMxBillingAdmin } from '~/server/utils/pacAccess'

// POST /api/facturacion/links — relaciona un CFDI con cualquier registro.
// La relación se valida en servidor y es idempotente.
const bodySchema = z.object({
  documentId: z.string().uuid(),
  entityId: z.string().uuid(),
  recordId: z.string().uuid(),
  relationType: z.string().trim().min(1).max(40).default('source'),
  amount: z.number().finite().nonnegative().nullable().optional(),
  currency: z.string().trim().length(3).nullable().optional(),
  metadata: z.record(z.unknown()).default({})
})

export default defineEventHandler(async (event) => {
  const auth = await requireMxBillingAdmin(event)
  const parsed = bodySchema.safeParse(await readBody(event))
  if (!parsed.success) throw createError({ statusCode: 422, statusMessage: 'Datos de relación fiscal inválidos' })
  return withTenant(auth.tenantId, async (tx) => {
    const [doc] = await tx.select({ id: cfdiDocuments.id }).from(cfdiDocuments).where(and(eq(cfdiDocuments.id, parsed.data.documentId), eq(cfdiDocuments.tenantId, auth.tenantId))).limit(1)
    if (!doc) throw createError({ statusCode: 404, statusMessage: 'El CFDI no existe' })
    const [record] = await tx.select({ id: records.id, entityId: records.entityId }).from(records).where(and(eq(records.id, parsed.data.recordId), eq(records.entityId, parsed.data.entityId), eq(records.tenantId, auth.tenantId))).limit(1)
    if (!record) throw createError({ statusCode: 404, statusMessage: 'El registro no existe en esta organización' })
    const [link] = await tx.insert(cfdiDocumentLinks).values({
      tenantId: auth.tenantId,
      documentId: parsed.data.documentId,
      entityId: parsed.data.entityId,
      recordId: parsed.data.recordId,
      relationType: parsed.data.relationType,
      amount: parsed.data.amount == null ? null : String(parsed.data.amount),
      currency: parsed.data.currency || null,
      metadata: parsed.data.metadata,
      createdBy: auth.sub ?? null
    }).onConflictDoNothing().returning({ id: cfdiDocumentLinks.id })
    return { id: link?.id ?? null, created: Boolean(link) }
  })
})
