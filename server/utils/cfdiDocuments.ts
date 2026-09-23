import { and, asc, desc, eq, gte, ilike, lte, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { withTenant } from '~/server/db'
import type { db } from '~/server/db'
import { cfdiConceptos, cfdiDocuments, cfdiDocumentLinks, cfdiEvents, cfdiPaymentDocs, cfdiSeries, records } from '~/server/db/schema'
import { CP_REGEX_SRC, FORMAS_PAGO, METODOS_PAGO, RFC_REGEX_SRC, REGIMENES_FISCALES, TIPOS_RELACION, USOS_CFDI, enCatalogo } from '~/utils/cfdiCatalogos'

type Tx = typeof db

// Fase C de DOCS/HU_Timbrado_CFDI_PAC.md: dominio de documentos fiscales.
// Los totales NUNCA los declara el cliente: el servidor los calcula desde los
// conceptos (cantidad × valorUnitario − descuento por línea, impuestos por
// línea agrupados por clave/tipoFactor/tasa, descuento global) — así el cuadre
// SAT es estructural y no una validación que pueda fallar después. Redondeo:
// importes de línea a 6 decimales (permite SAT), totales y montos de impuesto
// a 2. Un documento en `borrador` admite datos fiscales incompletos (se
// capturan por partes); lo exigente es `validarListoParaTimbrar` (timbrado.ts).

export class CfdiDocumentError extends Error {
  constructor(
    message: string,
    readonly statusCode: number = 400
  ) {
    super(message)
  }
}

export class CfdiDocumentNotFoundError extends CfdiDocumentError {
  constructor(message = 'El documento fiscal no existe') {
    super(message, 404)
  }
}

// ---------------------------------------------------------------------------
// Schemas de entrada (Zod, validación única en el dominio — criterio Gaps #3)
// ---------------------------------------------------------------------------

const impuestoLineaInput = z.object({
  clave: z.enum(['002', '003']),
  tipoFactor: z.enum(['Tasa', 'Cuota', 'Exento']).default('Tasa'),
  tasa: z.number().min(0).max(1)
})

const conceptoInput = z.object({
  claveProdServ: z.string().regex(/^\d{8}$/, 'La ClaveProdServ debe ser de 8 dígitos (catálogo SAT)'),
  claveUnidad: z.string().trim().min(2).max(6).default('H87'),
  cantidad: z.number().positive('La cantidad debe ser mayor a 0'),
  descripcion: z.string().trim().min(1).max(1000),
  valorUnitario: z.number().min(0),
  descuento: z.number().min(0).default(0),
  traslado: impuestoLineaInput.nullable().optional(),
  retencion: impuestoLineaInput.nullable().optional()
})

const receptorInput = z.object({
  rfc: z.string().trim().regex(new RegExp(RFC_REGEX_SRC), 'RFC con formato inválido').optional().or(z.literal('')),
  nombre: z.string().trim().min(1, 'El nombre del receptor es requerido').max(250),
  codigoPostal: z.string().trim().regex(new RegExp(CP_REGEX_SRC), 'Código postal de 5 dígitos').optional().or(z.literal('')),
  regimenFiscal: z.string().trim().length(3).optional().or(z.literal('')),
  correo: z.string().trim().email('Correo inválido').max(200).optional().or(z.literal('')).nullable()
})

export const documentoCreateSchema = z.object({
  serieId: z.string().uuid(),
  tipo: z.enum(['I', 'E']),
  customerEntityId: z.string().uuid().nullable().optional(),
  customerRecordId: z.string().uuid().nullable().optional(),
  // Registro dinámico de origen (ej. la cuenta_por_cobrar que dio lugar a la
  // factura). Solo se acepta el recordId: la entidad se resuelve EN EL
  // SERVIDOR desde el propio registro (nunca confiar en el entityId del
  // cliente). Es el vínculo que usa el complemento de pagos (fase E) para
  // encontrar la factura timbrada de cada aplicación de cobro.
  sourceRecordId: z.string().uuid().nullable().optional(),
  receptor: receptorInput,
  usoCfdi: z.string().trim().min(3).max(3),
  formaPago: z.string().trim().max(2).nullable().optional(),
  metodoPago: z.enum(['PUE', 'PPD']).default('PUE'),
  moneda: z.string().trim().length(3).default('MXN'),
  tipoCambio: z.number().positive().nullable().optional(),
  exportacion: z.enum(['01', '02', '03']).default('01'),
  descuentoDocumento: z.number().min(0).default(0),
  observaciones: z.string().trim().max(500).nullable().optional(),
  conceptos: z.array(conceptoInput).min(1, 'El documento necesita al menos un concepto').max(500),
  relacionado: z
    .object({ documentId: z.string().uuid(), tipoRelacion: z.string().trim().length(2) })
    .nullable()
    .optional()
})

export const documentoUpdateSchema = documentoCreateSchema.omit({ serieId: true, tipo: true }).partial()

export const serieCreateSchema = z.object({
  serie: z
    .string()
    .trim()
    .min(1, 'La serie es requerida')
    .max(25)
    .transform((v) => v.toUpperCase()) // normaliza ANTES de validar: 'f2' → 'F2'
    .refine((v) => /^[A-Z0-9]+$/.test(v), 'La serie solo admite mayúsculas y números (A-Z, 0-9)'),
  tipoComprobante: z.enum(['I', 'E', 'P']),
  lugarExpedicion: z.string().trim().regex(new RegExp(CP_REGEX_SRC), 'Lugar de expedición: código postal de 5 dígitos')
})

export const listDocumentsQuerySchema = z.object({
  tipo: z.enum(['I', 'E', 'P']).optional(),
  estado: z.enum(['borrador', 'timbrando', 'timbrada', 'error', 'cancelada']).optional(),
  serieId: z.string().uuid().optional(),
  q: z.string().trim().min(1).max(120).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20)
})

export type DocumentoCreateInput = z.infer<typeof documentoCreateSchema>
export type DocumentoUpdateInput = z.infer<typeof documentoUpdateSchema>

// ---------------------------------------------------------------------------
// Cálculo fiscal (redondeo SAT)
// ---------------------------------------------------------------------------

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

export function round6(n: number): number {
  return Math.round((n + Number.EPSILON) * 1e6) / 1e6
}

export interface LineaImpuestoComputada {
  base: number
  impuesto: string // '002' | '003'
  tipoFactor: 'Tasa' | 'Cuota' | 'Exento'
  tasaOCuota: number
  importe: number
}

export interface ConceptoComputado {
  orden: number
  claveProdServ: string
  claveUnidad: string
  cantidad: number
  descripcion: string
  valorUnitario: number
  descuento: number
  importe: number
  impuestos: { traslados: LineaImpuestoComputada[]; retenciones: LineaImpuestoComputada[] }
}

function computarLinea(tipo: 'traslado' | 'retencion', base: number, linea: { clave: string; tipoFactor: string; tasa: number } | null | undefined): LineaImpuestoComputada | null {
  if (!linea) return null
  const importe = linea.tipoFactor === 'Exento' ? 0 : round2(base * linea.tasa)
  return { base: round2(base), impuesto: linea.clave, tipoFactor: linea.tipoFactor as LineaImpuestoComputada['tipoFactor'], tasaOCuota: linea.tasa, importe }
}

export function computarConceptos(input: z.infer<typeof documentoCreateSchema>['conceptos']): ConceptoComputado[] {
  return input.map((c, i) => {
    const importe = round6(c.cantidad * c.valorUnitario)
    const base = Math.max(0, round6(importe - c.descuento))
    const traslado = computarLinea('traslado', base, c.traslado)
    const retencion = computarLinea('retencion', base, c.retencion)
    return {
      orden: i + 1,
      claveProdServ: c.claveProdServ,
      claveUnidad: c.claveUnidad,
      cantidad: c.cantidad,
      descripcion: c.descripcion,
      valorUnitario: c.valorUnitario,
      descuento: c.descuento,
      importe,
      impuestos: { traslados: traslado ? [traslado] : [], retenciones: retencion ? [retencion] : [] }
    }
  })
}

export interface TotalesComputados {
  subtotal: number
  descuentoTotal: number
  total: number
  impuestos: { traslados: LineaImpuestoComputada[]; retenciones: LineaImpuestoComputada[] }
}

/** Agrupa traslados/retenciones por (clave, tipoFactor, tasa) como exige el XML. */
function agrupar(lineas: LineaImpuestoComputada[]): LineaImpuestoComputada[] {
  const mapa = new Map<string, LineaImpuestoComputada>()
  for (const l of lineas) {
    const key = `${l.impuesto}|${l.tipoFactor}|${l.tasaOCuota}`
    const previo = mapa.get(key)
    if (previo) {
      previo.base = round2(previo.base + l.base)
      previo.importe = round2(previo.importe + l.importe)
    } else {
      mapa.set(key, { ...l })
    }
  }
  return [...mapa.values()]
}

export function computarTotales(conceptos: ConceptoComputado[], descuentoDocumento: number): TotalesComputados {
  const subtotal = round2(conceptos.reduce((acc, c) => acc + c.importe, 0))
  const descuentosLineas = round2(conceptos.reduce((acc, c) => acc + c.descuento, 0))
  const traslados = agrupar(conceptos.flatMap((c) => c.impuestos.traslados))
  const retenciones = agrupar(conceptos.flatMap((c) => c.impuestos.retenciones))
  const totalTrasladado = round2(traslados.reduce((acc, t) => acc + t.importe, 0))
  const totalRetenido = round2(retenciones.reduce((acc, r) => acc + r.importe, 0))
  return {
    subtotal,
    descuentoTotal: round2(descuentoDocumento + descuentosLineas),
    total: round2(subtotal - descuentoDocumento + totalTrasladado - totalRetenido),
    impuestos: { traslados, retenciones }
  }
}

// ---------------------------------------------------------------------------
// Series
// ---------------------------------------------------------------------------

export async function listSeries(tenantId: string) {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx.select().from(cfdiSeries).where(eq(cfdiSeries.tenantId, tenantId)).orderBy(asc(cfdiSeries.tipoComprobante), asc(cfdiSeries.serie))
    return rows.map((r) => ({
      id: r.id,
      serie: r.serie,
      tipoComprobante: r.tipoComprobante,
      lugarExpedicion: r.lugarExpedicion,
      nextFolio: r.nextFolio,
      estado: r.estado
    }))
  })
}

export async function createSerie(tenantId: string, input: z.infer<typeof serieCreateSchema>) {
  return withTenant(tenantId, async (tx) => {
    const [dup] = await tx
      .select({ id: cfdiSeries.id })
      .from(cfdiSeries)
      .where(and(eq(cfdiSeries.tenantId, tenantId), eq(cfdiSeries.serie, input.serie), eq(cfdiSeries.tipoComprobante, input.tipoComprobante)))
      .limit(1)
    if (dup) throw new CfdiDocumentError(`Ya existe una serie "${input.serie}" para comprobantes tipo ${input.tipoComprobante}`, 409)
    const [row] = await tx
      .insert(cfdiSeries)
      .values({ tenantId, serie: input.serie, tipoComprobante: input.tipoComprobante, lugarExpedicion: input.lugarExpedicion })
      .returning({ id: cfdiSeries.id })
    return row
  })
}

export async function setSerieEstado(tenantId: string, serieId: string, estado: 'activa' | 'inactiva') {
  return withTenant(tenantId, async (tx) => {
    const [row] = await tx.update(cfdiSeries).set({ estado, updatedAt: new Date() }).where(and(eq(cfdiSeries.id, serieId), eq(cfdiSeries.tenantId, tenantId))).returning({ id: cfdiSeries.id, estado: cfdiSeries.estado })
    if (!row) throw new CfdiDocumentNotFoundError('La serie no existe')
    return row
  })
}

// ---------------------------------------------------------------------------
// Documentos
// ---------------------------------------------------------------------------

function validarCatalogos(input: DocumentoCreateInput | DocumentoUpdateInput) {
  if (input.usoCfdi !== undefined && !enCatalogo(USOS_CFDI, input.usoCfdi)) throw new CfdiDocumentError(`Uso de CFDI inválido: ${input.usoCfdi}`)
  if (input.formaPago !== undefined && input.formaPago !== null && input.formaPago !== '' && !enCatalogo(FORMAS_PAGO, input.formaPago)) throw new CfdiDocumentError(`Forma de pago inválida: ${input.formaPago}`)
  if (input.metodoPago !== undefined && !enCatalogo(METODOS_PAGO, input.metodoPago)) throw new CfdiDocumentError(`Método de pago inválido: ${input.metodoPago}`)
  if (input.receptor?.regimenFiscal && !enCatalogo(REGIMENES_FISCALES, input.receptor.regimenFiscal)) throw new CfdiDocumentError(`Régimen fiscal inválido: ${input.receptor.regimenFiscal}`)
  if (input.relacionado && !enCatalogo(TIPOS_RELACION, input.relacionado.tipoRelacion)) throw new CfdiDocumentError(`Tipo de relación inválido: ${input.relacionado.tipoRelacion}`)
}

function receptorColumns(receptor: z.infer<typeof receptorInput>) {
  return {
    receptorRfc: receptor.rfc?.trim() || null,
    receptorNombre: receptor.nombre.trim(),
    receptorCodigoPostal: receptor.codigoPostal?.trim() || null,
    receptorRegimenFiscal: receptor.regimenFiscal?.trim() || null,
    receptorCorreo: receptor.correo?.trim() || null
  }
}

export async function createDocument(tenantId: string, userId: string | null, input: DocumentoCreateInput): Promise<{ id: string }> {
  validarCatalogos(input)
  return withTenant(tenantId, async (tx) => {
    const [serie] = await tx.select().from(cfdiSeries).where(and(eq(cfdiSeries.id, input.serieId), eq(cfdiSeries.tenantId, tenantId))).limit(1)
    if (!serie) throw new CfdiDocumentNotFoundError('La serie fiscal no existe')
    if (serie.tipoComprobante !== input.tipo) throw new CfdiDocumentError(`La serie "${serie.serie}" es para comprobantes tipo ${serie.tipoComprobante}, no ${input.tipo}`)
    if (serie.estado !== 'activa') throw new CfdiDocumentError(`La serie "${serie.serie}" está inactiva`)

    let relacionadoId: string | null = null
    if (input.relacionado) {
      const [rel] = await tx.select({ id: cfdiDocuments.id, estado: cfdiDocuments.estado, uuidFiscal: cfdiDocuments.uuidFiscal }).from(cfdiDocuments).where(and(eq(cfdiDocuments.id, input.relacionado.documentId), eq(cfdiDocuments.tenantId, tenantId))).limit(1)
      if (!rel) throw new CfdiDocumentError('El CFDI relacionado no existe', 404)
      if (!rel.uuidFiscal || rel.estado !== 'timbrada') throw new CfdiDocumentError('Solo puedes relacionar un CFDI ya timbrado')
      relacionadoId = rel.id
    }
    if (input.tipo === 'E' && !relacionadoId) throw new CfdiDocumentError('Una nota de crédito (tipo E) debe relacionar la factura que modifica')

    // Origen dinámico: el cliente manda SOLO el recordId; la entidad se
    // resuelve aquí desde el propio registro (RLS garantiza que sea del
    // tenant). Este vínculo es el que usa el complemento de pagos (fase E)
    // para encontrar la factura timbrada de cada aplicación de cobro.
    let sourceEntityId: string | null = null
    if (input.sourceRecordId) {
      const [sourceRecord] = await tx.select({ entityId: records.entityId }).from(records).where(and(eq(records.id, input.sourceRecordId), eq(records.tenantId, tenantId))).limit(1)
      if (!sourceRecord) throw new CfdiDocumentError('El registro de origen no existe en esta organización', 404)
      sourceEntityId = sourceRecord.entityId
    }

    const conceptos = computarConceptos(input.conceptos)
    const totales = computarTotales(conceptos, input.descuentoDocumento)

    const [doc] = await tx
      .insert(cfdiDocuments)
      .values({
        tenantId,
        serieId: serie.id,
        tipo: input.tipo,
        estado: 'borrador',
        customerEntityId: input.customerEntityId ?? null,
        customerRecordId: input.customerRecordId ?? null,
        sourceEntityId,
        sourceRecordId: input.sourceRecordId ?? null,
        ...receptorColumns(input.receptor),
        usoCfdi: input.usoCfdi,
        formaPago: input.formaPago || null,
        metodoPago: input.metodoPago,
        moneda: input.moneda,
        tipoCambio: input.tipoCambio != null ? String(input.tipoCambio) : null,
        subtotal: String(totales.subtotal),
        descuento: String(input.descuentoDocumento),
        total: String(totales.total),
        impuestos: totales.impuestos,
        exportacion: input.exportacion,
        cfdiRelacionadoId: relacionadoId,
        tipoRelacion: relacionadoId ? input.relacionado!.tipoRelacion : null,
        observaciones: input.observaciones || null,
        createdBy: userId
      })
      .returning({ id: cfdiDocuments.id })

    if (conceptos.length) {
      await tx.insert(cfdiConceptos).values(
        conceptos.map((c) => ({
          tenantId,
          documentId: doc.id,
          orden: c.orden,
          claveProdServ: c.claveProdServ,
          claveUnidad: c.claveUnidad,
          cantidad: String(c.cantidad),
          descripcion: c.descripcion,
          valorUnitario: String(c.valorUnitario),
          descuento: String(c.descuento),
          importe: String(c.importe),
          impuestos: c.impuestos
        }))
      )
    }
    if (input.sourceRecordId && sourceEntityId) {
      await tx.insert(cfdiDocumentLinks).values({
        tenantId,
        documentId: doc.id,
        entityId: sourceEntityId,
        recordId: input.sourceRecordId,
        relationType: 'source',
        currency: input.moneda,
        amount: String(totales.total),
        createdBy: userId
      }).onConflictDoNothing()
    }
    return { id: doc.id }
  })
}

async function loadForEdit(tx: Tx, tenantId: string, id: string) {
  const [doc] = await tx.select().from(cfdiDocuments).where(and(eq(cfdiDocuments.id, id), eq(cfdiDocuments.tenantId, tenantId))).limit(1)
  if (!doc) throw new CfdiDocumentNotFoundError()
  return doc
}

export async function updateDocument(tenantId: string, userId: string | null, id: string, input: DocumentoUpdateInput): Promise<{ id: string }> {
  validarCatalogos(input)
  return withTenant(tenantId, async (tx) => {
    const doc = await loadForEdit(tx, tenantId, id)
    if (doc.uuidFiscal || doc.estado === 'timbrada' || doc.estado === 'cancelada' || doc.estado === 'timbrando') {
      throw new CfdiDocumentError('Un documento timbrado, en proceso o cancelado ya no se edita (inmutabilidad fiscal)', 409)
    }

    const patch: Record<string, unknown> = { updatedAt: new Date() }
    if (input.receptor) Object.assign(patch, receptorColumns(input.receptor))
    for (const key of ['usoCfdi', 'metodoPago', 'moneda', 'exportacion'] as const) {
      if (input[key] !== undefined) patch[key] = input[key]
    }
    if (input.formaPago !== undefined) patch.formaPago = input.formaPago || null
    if (input.tipoCambio !== undefined) patch.tipoCambio = input.tipoCambio != null ? String(input.tipoCambio) : null
    if (input.observaciones !== undefined) patch.observaciones = input.observaciones || null
    if (input.customerEntityId !== undefined) patch.customerEntityId = input.customerEntityId
    if (input.customerRecordId !== undefined) patch.customerRecordId = input.customerRecordId
    let sourceEntityId: string | null | undefined
    if (input.sourceRecordId !== undefined) {
      sourceEntityId = null
      if (input.sourceRecordId) {
        const [source] = await tx.select({ entityId: records.entityId }).from(records).where(and(eq(records.id, input.sourceRecordId), eq(records.tenantId, tenantId))).limit(1)
        if (!source) throw new CfdiDocumentError('El registro de origen no existe en esta organización', 404)
        sourceEntityId = source.entityId
      }
      patch.sourceRecordId = input.sourceRecordId
      patch.sourceEntityId = sourceEntityId
    }

    let conceptosNuevos: ConceptoComputado[] | null = null
    let descuentoDocumento = Number(doc.descuento)
    if (input.descuentoDocumento !== undefined) {
      descuentoDocumento = input.descuentoDocumento
      patch.descuento = String(descuentoDocumento)
    }
    if (input.conceptos) {
      conceptosNuevos = computarConceptos(input.conceptos)
      await tx.delete(cfdiConceptos).where(eq(cfdiConceptos.documentId, doc.id))
      await tx.insert(cfdiConceptos).values(
        conceptosNuevos.map((c) => ({
          tenantId,
          documentId: doc.id,
          orden: c.orden,
          claveProdServ: c.claveProdServ,
          claveUnidad: c.claveUnidad,
          cantidad: String(c.cantidad),
          descripcion: c.descripcion,
          valorUnitario: String(c.valorUnitario),
          descuento: String(c.descuento),
          importe: String(c.importe),
          impuestos: c.impuestos
        }))
      )
    }
    if (conceptosNuevos || input.descuentoDocumento !== undefined) {
      const conceptos = conceptosNuevos ?? (await tx.select().from(cfdiConceptos).where(eq(cfdiConceptos.documentId, doc.id))).map(mapConceptoRow)
      const totales = computarTotales(conceptos, descuentoDocumento)
      patch.subtotal = String(totales.subtotal)
      patch.total = String(totales.total)
      patch.impuestos = totales.impuestos
    }
    if (input.relacionado !== undefined) {
      if (input.relacionado === null) {
        if (doc.tipo === 'E') throw new CfdiDocumentError('Una nota de crédito (tipo E) debe relacionar la factura que modifica')
        patch.cfdiRelacionadoId = null
        patch.tipoRelacion = null
      } else {
        const [rel] = await tx.select({ id: cfdiDocuments.id, uuidFiscal: cfdiDocuments.uuidFiscal, estado: cfdiDocuments.estado }).from(cfdiDocuments).where(and(eq(cfdiDocuments.id, input.relacionado.documentId), eq(cfdiDocuments.tenantId, tenantId))).limit(1)
        if (!rel) throw new CfdiDocumentError('El CFDI relacionado no existe', 404)
        if (!rel.uuidFiscal || rel.estado !== 'timbrada') throw new CfdiDocumentError('Solo puedes relacionar un CFDI ya timbrado')
        patch.cfdiRelacionadoId = rel.id
        patch.tipoRelacion = input.relacionado.tipoRelacion
      }
    }

    await tx.update(cfdiDocuments).set(patch).where(eq(cfdiDocuments.id, doc.id))
    if (input.sourceRecordId !== undefined) {
      await tx.delete(cfdiDocumentLinks).where(and(eq(cfdiDocumentLinks.documentId, doc.id), eq(cfdiDocumentLinks.relationType, 'source')))
      if (input.sourceRecordId && sourceEntityId) {
        const total = conceptosNuevos || input.descuentoDocumento !== undefined
          ? Number(patch.total)
          : Number(doc.total)
        await tx.insert(cfdiDocumentLinks).values({
          tenantId,
          documentId: doc.id,
          entityId: sourceEntityId,
          recordId: input.sourceRecordId,
          relationType: 'source',
          amount: String(total),
          currency: input.moneda ?? doc.moneda,
          createdBy: userId
        })
      }
    }
    return { id: doc.id }
  })
}

export async function deleteDocument(tenantId: string, id: string): Promise<void> {
  await withTenant(tenantId, async (tx) => {
    const [doc] = await tx.select({ id: cfdiDocuments.id, estado: cfdiDocuments.estado, folio: cfdiDocuments.folio }).from(cfdiDocuments).where(and(eq(cfdiDocuments.id, id), eq(cfdiDocuments.tenantId, tenantId))).limit(1)
    if (!doc) throw new CfdiDocumentNotFoundError()
    if (doc.estado !== 'borrador' || doc.folio != null) {
      throw new CfdiDocumentError('Solo se elimina un borrador que nunca intentó timbrarse; los demás se cancelan ante el SAT', 409)
    }
    await tx.delete(cfdiDocuments).where(eq(cfdiDocuments.id, doc.id))
  })
}

export function mapConceptoRow(row: typeof cfdiConceptos.$inferSelect): ConceptoComputado {
  return {
    orden: row.orden,
    claveProdServ: row.claveProdServ,
    claveUnidad: row.claveUnidad,
    cantidad: Number(row.cantidad),
    descripcion: row.descripcion,
    valorUnitario: Number(row.valorUnitario),
    descuento: Number(row.descuento),
    importe: Number(row.importe),
    impuestos: row.impuestos as ConceptoComputado['impuestos']
  }
}

export async function listDocuments(tenantId: string, query: z.infer<typeof listDocumentsQuerySchema>) {
  return withTenant(tenantId, async (tx) => {
    const conditions = [eq(cfdiDocuments.tenantId, tenantId)]
    if (query.tipo) conditions.push(eq(cfdiDocuments.tipo, query.tipo))
    if (query.estado) conditions.push(eq(cfdiDocuments.estado, query.estado))
    if (query.serieId) conditions.push(eq(cfdiDocuments.serieId, query.serieId))
    if (query.from) conditions.push(gte(cfdiDocuments.createdAt, new Date(`${query.from}T00:00:00.000Z`)))
    if (query.to) conditions.push(lte(cfdiDocuments.createdAt, new Date(`${query.to}T23:59:59.999Z`)))
    if (query.q) {
      const q = query.q
      conditions.push(
        or(
          ilike(cfdiDocuments.receptorNombre, `%${q}%`),
          ilike(cfdiDocuments.receptorRfc, `%${q}%`),
          ilike(cfdiDocuments.uuidFiscal, `%${q}%`),
          /^\d+$/.test(q) ? sql`${cfdiDocuments.folio}::text = ${q}` : sql`false`
        )!
      )
    }
    const where = and(...conditions)
    const [countRow] = await tx.select({ total: sql<number>`count(*)::int` }).from(cfdiDocuments).where(where)
    const rows = await tx
      .select({
        id: cfdiDocuments.id,
        folio: cfdiDocuments.folio,
        tipo: cfdiDocuments.tipo,
        estado: cfdiDocuments.estado,
        serie: cfdiSeries.serie,
        receptorNombre: cfdiDocuments.receptorNombre,
        receptorRfc: cfdiDocuments.receptorRfc,
        uuidFiscal: cfdiDocuments.uuidFiscal,
        fechaTimbrado: cfdiDocuments.fechaTimbrado,
        total: cfdiDocuments.total,
        moneda: cfdiDocuments.moneda,
        createdAt: cfdiDocuments.createdAt
      })
      .from(cfdiDocuments)
      .innerJoin(cfdiSeries, eq(cfdiSeries.id, cfdiDocuments.serieId))
      .where(where)
      .orderBy(desc(cfdiDocuments.createdAt))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize)
    return { rows, total: countRow?.total ?? 0, page: query.page, pageSize: query.pageSize }
  })
}

export async function getDocumentDetail(tenantId: string, id: string) {
  return withTenant(tenantId, async (tx) => {
    const [doc] = await tx
      .select({
        documento: cfdiDocuments,
        serie: { id: cfdiSeries.id, serie: cfdiSeries.serie, tipoComprobante: cfdiSeries.tipoComprobante, lugarExpedicion: cfdiSeries.lugarExpedicion }
      })
      .from(cfdiDocuments)
      .innerJoin(cfdiSeries, eq(cfdiSeries.id, cfdiDocuments.serieId))
      .where(and(eq(cfdiDocuments.id, id), eq(cfdiDocuments.tenantId, tenantId)))
      .limit(1)
    if (!doc) throw new CfdiDocumentNotFoundError()

    const conceptos = await tx.select().from(cfdiConceptos).where(eq(cfdiConceptos.documentId, id)).orderBy(asc(cfdiConceptos.orden))
    const events = await tx.select().from(cfdiEvents).where(eq(cfdiEvents.documentId, id)).orderBy(asc(cfdiEvents.createdAt))
    const pagos = await tx
      .select({
        fila: cfdiPaymentDocs,
        relacionado: { id: cfdiDocuments.id, folio: cfdiDocuments.folio, uuidFiscal: cfdiDocuments.uuidFiscal, total: cfdiDocuments.total, moneda: cfdiDocuments.moneda, receptorNombre: cfdiDocuments.receptorNombre }
      })
      .from(cfdiPaymentDocs)
      .innerJoin(cfdiDocuments, eq(cfdiDocuments.id, cfdiPaymentDocs.relatedCfdiId))
      .where(eq(cfdiPaymentDocs.documentId, id))
      .orderBy(asc(cfdiPaymentDocs.createdAt))
    const relacionado = doc.documento.cfdiRelacionadoId
      ? await tx
          .select({ id: cfdiDocuments.id, folio: cfdiDocuments.folio, tipo: cfdiDocuments.tipo, estado: cfdiDocuments.estado, uuidFiscal: cfdiDocuments.uuidFiscal, total: cfdiDocuments.total, moneda: cfdiDocuments.moneda, receptorNombre: cfdiDocuments.receptorNombre })
          .from(cfdiDocuments)
          .where(eq(cfdiDocuments.id, doc.documento.cfdiRelacionadoId))
          .limit(1)
      : []
    const relaciones = await tx
      .select()
      .from(cfdiDocumentLinks)
      .where(and(eq(cfdiDocumentLinks.tenantId, tenantId), eq(cfdiDocumentLinks.documentId, id)))
      .orderBy(asc(cfdiDocumentLinks.createdAt))

    return {
      documento: doc.documento,
      serie: doc.serie,
      conceptos: conceptos.map(mapConceptoRow),
      pagos: pagos.map((p) => ({ ...p.fila, relacionado: p.relacionado })),
      relacionado: relacionado[0] ?? null,
      relaciones,
      events
    }
  })
}

/** Opciones para el selector "relacionar factura" (solo timbradas tipo I). */
export async function listTimbradasParaRelacionar(tenantId: string) {
  return withTenant(tenantId, async (tx) => {
    return tx
      .select({ id: cfdiDocuments.id, folio: cfdiDocuments.folio, serie: cfdiSeries.serie, uuidFiscal: cfdiDocuments.uuidFiscal, receptorNombre: cfdiDocuments.receptorNombre, total: cfdiDocuments.total, moneda: cfdiDocuments.moneda, fechaTimbrado: cfdiDocuments.fechaTimbrado })
      .from(cfdiDocuments)
      .innerJoin(cfdiSeries, eq(cfdiSeries.id, cfdiDocuments.serieId))
      .where(and(eq(cfdiDocuments.tenantId, tenantId), eq(cfdiDocuments.tipo, 'I'), eq(cfdiDocuments.estado, 'timbrada')))
      .orderBy(desc(cfdiDocuments.fechaTimbrado))
      .limit(100)
  })
}
