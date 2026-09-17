import { and, eq, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'
import { withTenant } from '~/server/db'
import type { db } from '~/server/db'
import { cfdiDocuments, cfdiPaymentDocs, cfdiSeries, entities, records } from '~/server/db/schema'
import { CfdiDocumentError } from '~/server/utils/cfdiDocuments'
import { FORMAS_PAGO, enCatalogo } from '~/utils/cfdiCatalogos'

// Fase E de DOCS/HU_Timbrado_CFDI_PAC.md: complemento de pagos 2.0 nacido de
// un cobro dinámico. El mundo dinámico es el ORIGEN: `cobros_cliente` (estado
// aplicado) + `aplicaciones_cobro` (monto aplicado a cada cuenta_por_cobrar);
// cada CxC debe tener su factura tipo I TIMBRADA en el dominio fijo, vinculada
// por source_record_id (así se creó desde el botón "Generar factura" del
// registro). El documento P resultante es borrador y se timbra con el mismo
// motor (stampDocument, tipo P).
//
// Saldos: impSaldoAnt = total de la factura relacionada − suma de pagos ya
// documentados (cfdi_payment_docs previos sobre el mismo related_cfdi_id);
// impSaldoIns = impSaldoAnt − impPagado. La fuente de verdad del saldo del
// CxC sigue siendo el módulo dinámico; aquí solo se documenta lo fiscal.

type Tx = typeof db

export const complementoCreateSchema = z.object({
  cobroRecordId: z.string().uuid(),
  formaPago: z
    .string()
    .trim()
    .optional()
    .refine((v) => !v || enCatalogo(FORMAS_PAGO, v), 'Forma de pago fuera del catálogo SAT'),
  serieId: z.string().uuid().optional()
})

const MODULES = { cobros: 'cobros_cliente', aplicaciones: 'aplicaciones_cobro' } as const

async function entityBySlug(tx: Tx, tenantId: string, slug: string) {
  // entities no tiene deletedAt (solo records, ERD-87); un modulo "borrado"
  // del editor queda isActive=false, y para este flujo basta con que exista.
  const [row] = await tx.select({ id: entities.id, name: entities.name }).from(entities).where(and(eq(entities.tenantId, tenantId), eq(entities.slug, slug))).limit(1)
  return row ?? null
}

export async function generarComplementoDesdeCobro(tenantId: string, userId: string | null, input: z.infer<typeof complementoCreateSchema>): Promise<{ id: string }> {
  return withTenant(tenantId, async (tx) => {
    const cobrosEntity = await entityBySlug(tx, tenantId, MODULES.cobros)
    const aplicacionesEntity = await entityBySlug(tx, tenantId, MODULES.aplicaciones)
    if (!cobrosEntity || !aplicacionesEntity) {
      throw new CfdiDocumentError('Este flujo requiere los módulos de la Business Suite: cobros_cliente y aplicaciones_cobro', 422)
    }

    const [cobro] = await tx.select().from(records).where(and(eq(records.id, input.cobroRecordId), eq(records.entityId, cobrosEntity.id), eq(records.tenantId, tenantId), isNull(records.deletedAt))).limit(1)
    if (!cobro) throw new CfdiDocumentError('El cobro no existe', 404)
    const cobroData = (cobro.customData ?? {}) as Record<string, unknown>
    if (cobroData.estado !== 'aplicado') throw new CfdiDocumentError('El cobro debe estar en estado "aplicado" para documentarlo')

    const aplicaciones = await tx
      .select()
      .from(records)
      .where(and(eq(records.entityId, aplicacionesEntity.id), eq(records.tenantId, tenantId), isNull(records.deletedAt), sql`${records.customData}->>'cobro' = ${cobro.id}`))
    if (!aplicaciones.length) throw new CfdiDocumentError('El cobro no tiene aplicaciones registradas; no hay nada que documentar')

    // Forma de pago: explícita en el body, o la clave SAT del método de pago
    // dinámico del cobro (metodos_pago.clave), si coincide con el catálogo.
    let formaPago = input.formaPago ?? null
    if (!formaPago && typeof cobroData.metodo_pago === 'string' && cobroData.metodo_pago) {
      const [metodo] = await tx
        .select({ clave: sql<string>`${records.customData}->>'clave'` })
        .from(records)
        .where(and(eq(records.id, cobroData.metodo_pago as string), eq(records.tenantId, tenantId), isNull(records.deletedAt)))
        .limit(1)
      if (metodo?.clave && enCatalogo(FORMAS_PAGO, metodo.clave)) formaPago = metodo.clave
    }
    if (!formaPago) throw new CfdiDocumentError('Indica la forma de pago del complemento (catálogo SAT c_FormaPago)')

    // Serie tipo P: la indicada o la primera activa
    let serie
    if (input.serieId) {
      const [row] = await tx.select().from(cfdiSeries).where(and(eq(cfdiSeries.id, input.serieId), eq(cfdiSeries.tenantId, tenantId))).limit(1)
      if (!row) throw new CfdiDocumentError('La serie no existe', 404)
      if (row.tipoComprobante !== 'P') throw new CfdiDocumentError(`La serie "${row.serie}" no es de comprobantes tipo P`)
      if (row.estado !== 'activa') throw new CfdiDocumentError(`La serie "${row.serie}" está inactiva`)
      serie = row
    } else {
      const [row] = await tx.select().from(cfdiSeries).where(and(eq(cfdiSeries.tenantId, tenantId), eq(cfdiSeries.tipoComprobante, 'P'), eq(cfdiSeries.estado, 'activa'))).limit(1)
      if (!row) throw new CfdiDocumentError('Crea una serie tipo P en Facturación → Series antes de generar complementos')
      serie = row
    }

    // Resolver cada aplicación a su factura timbrada
    const doctos: Array<{
      relatedCfdiId: string
      uuidFiscal: string
      facturaTotal: number
      facturaMoneda: string
      facturaTipoCambio: string | null
      impPagado: number
    }> = []
    let receptorCopiado: {
      customerEntityId: string | null
      customerRecordId: string | null
      receptorRfc: string | null
      receptorNombre: string | null
      receptorCodigoPostal: string | null
      receptorRegimenFiscal: string | null
      receptorCorreo: string | null
    } | null = null

    for (const app of aplicaciones) {
      const appData = (app.customData ?? {}) as Record<string, unknown>
      const monto = Number(appData.monto)
      const cxcId = typeof appData.cuenta_por_cobrar === 'string' ? appData.cuenta_por_cobrar : null
      if (!cxcId || !Number.isFinite(monto) || monto <= 0) {
        throw new CfdiDocumentError('Hay una aplicación sin cuenta por cobrar o con monto inválido; corrígela en el módulo dinámico')
      }
      const [factura] = await tx
        .select()
        .from(cfdiDocuments)
        .where(and(eq(cfdiDocuments.tenantId, tenantId), eq(cfdiDocuments.tipo, 'I'), eq(cfdiDocuments.estado, 'timbrada'), eq(cfdiDocuments.sourceRecordId, cxcId)))
        .limit(1)
      if (!factura?.uuidFiscal) {
        throw new CfdiDocumentError(`La cuenta por cobrar de esa aplicación no tiene una factura timbrada asociada. Timbra la factura primero (se vincula por registro de origen).`, 422)
      }
      if (!receptorCopiado) {
        receptorCopiado = {
          customerEntityId: factura.customerEntityId,
          customerRecordId: factura.customerRecordId,
          receptorRfc: factura.receptorRfc,
          receptorNombre: factura.receptorNombre,
          receptorCodigoPostal: factura.receptorCodigoPostal,
          receptorRegimenFiscal: factura.receptorRegimenFiscal,
          receptorCorreo: factura.receptorCorreo
        }
      }
      doctos.push({
        relatedCfdiId: factura.id,
        uuidFiscal: factura.uuidFiscal,
        facturaTotal: Number(factura.total),
        facturaMoneda: factura.moneda,
        facturaTipoCambio: factura.tipoCambio,
        impPagado: Math.round(monto * 100) / 100
      })
    }
    if (!receptorCopiado) throw new CfdiDocumentError('No se pudo resolver el receptor del complemento')

    // Saldos por factura: total − pagos ya documentados en complementos
    // anteriores (excluyendo borradores cancelados/no timbrados? se cuentan
    // todos los payment_docs existentes: un P borrador ya aparta saldo; si se
    // borra, el saldo vuelve — los borradores SÍ se eliminan en cascada).
    const lineas: Array<Record<string, unknown>> = []
    for (const d of doctos) {
      const [previo] = await tx
        .select({ suma: sql<number>`coalesce(sum(${cfdiPaymentDocs.impPagado}), 0)::float` })
        .from(cfdiPaymentDocs)
        .where(eq(cfdiPaymentDocs.relatedCfdiId, d.relatedCfdiId))
      const pagadoAntes = Number(previo?.suma ?? 0)
      const impSaldoAnt = Math.round((d.facturaTotal - pagadoAntes) * 100) / 100
      if (d.impPagado > impSaldoAnt + 0.005) {
        throw new CfdiDocumentError(`Una aplicación ($${d.impPagado}) excede el saldo pendiente de la factura relacionada ($${impSaldoAnt})`, 422)
      }
      const [parcialidad] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(cfdiPaymentDocs)
        .where(eq(cfdiPaymentDocs.relatedCfdiId, d.relatedCfdiId))
      lineas.push({
        tenantId,
        relatedCfdiId: d.relatedCfdiId,
        numParcialidad: (parcialidad?.n ?? 0) + 1,
        impSaldoAnt: String(impSaldoAnt),
        impPagado: String(d.impPagado),
        impSaldoIns: String(Math.round((impSaldoAnt - d.impPagado) * 100) / 100),
        monedaDr: d.facturaMoneda,
        tipoCambioDr: d.facturaTipoCambio // numeric: string|null directo de la factura relacionada
      })
    }

    const montoTotal = Math.round(doctos.reduce((acc, d) => acc + d.impPagado, 0) * 100) / 100
    const fechaPagoRaw = typeof cobroData.fecha === 'string' ? new Date(cobroData.fecha) : null
    const fechaPago = fechaPagoRaw && !Number.isNaN(fechaPagoRaw.getTime()) ? fechaPagoRaw : new Date()
    const moneda = typeof cobroData.moneda === 'string' && cobroData.moneda ? cobroData.moneda : 'MXN'

    const [doc] = await tx
      .insert(cfdiDocuments)
      .values({
        tenantId,
        serieId: serie.id,
        tipo: 'P',
        estado: 'borrador',
        ...receptorCopiado!,
        usoCfdi: 'P01',
        formaPago,
        metodoPago: 'PUE', // el complemento SIEMPRE es PUE (el pago ya ocurrió)
        moneda,
        subtotal: String(montoTotal),
        total: String(montoTotal),
        impuestos: {},
        exportacion: '01',
        fechaPago,
        sourceEntityId: cobrosEntity.id,
        sourceRecordId: cobro.id,
        observaciones: typeof cobroData.referencia === 'string' && cobroData.referencia ? `Cobro ${cobroData.referencia}`.slice(0, 500) : null,
        createdBy: userId
      })
      .returning({ id: cfdiDocuments.id })

    await tx.insert(cfdiPaymentDocs).values(lineas.map((l) => ({ ...(l as object), documentId: doc.id })) as typeof cfdiPaymentDocs.$inferInsert[])
    return { id: doc.id }
  })
}
