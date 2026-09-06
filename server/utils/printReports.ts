import { and, eq, sql as dsql } from 'drizzle-orm'
import { withTenant } from '~/server/db'
import { printReports } from '~/server/db/schema'
import { executePrintReport, printReportDslSchema, type PrintReportDsl, type PrintReportResult } from '~/server/utils/printReport'

// ERD-88 (Diseñador de reportes imprimibles): orquestación de las plantillas
// guardadas (server/api/print-reports/*.ts) - separada de los endpoints para
// poder testearla sin pasar por HTTP, mismo patron que server/utils/reports.ts
// (Reportería IA) y triggerAdmin.ts/moduleEntities.ts.
//
// A diferencia de reports.ts, acá NO hay un paso de "previsualización con
// IA" - el DSL lo arma directamente el Diseñador de 3 columnas (frontend),
// y "ejecutar" (previewPrintReport) es solo correr printReport.ts contra los
// datos VIGENTES - ver el comentario largo sobre esto en server/db/schema.ts,
// junto a la definición de la tabla print_reports.

export class PrintReportNotFoundError extends Error {}

export interface PrintReportListItem {
  id: string
  title: string
  baseEntitySlug: string
  updatedAt: string
}

export interface PrintReportRecord {
  id: string
  title: string
  baseEntitySlug: string
  dsl: PrintReportDsl
  createdAt: string
  updatedAt: string
}

/** "REPORTES GUARDADOS" de Screen/Generar reporte - más recién editado primero. */
export async function listPrintReports(tenantId: string, baseEntitySlug?: string): Promise<PrintReportListItem[]> {
  return withTenant(tenantId, async (tx) => {
    const conditions = [eq(printReports.tenantId, tenantId)]
    if (baseEntitySlug) conditions.push(eq(printReports.baseEntitySlug, baseEntitySlug))
    const rows = await tx
      .select({ id: printReports.id, title: printReports.title, baseEntitySlug: printReports.baseEntitySlug, updatedAt: printReports.updatedAt })
      .from(printReports)
      .where(and(...conditions))
      .orderBy(dsql`${printReports.updatedAt} desc`)
    return rows.map((r) => ({ ...r, updatedAt: r.updatedAt.toISOString() }))
  })
}

function toRecord(row: typeof printReports.$inferSelect): PrintReportRecord {
  return {
    id: row.id,
    title: row.title,
    baseEntitySlug: row.baseEntitySlug,
    dsl: row.dsl as PrintReportDsl,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  }
}

/** Detalle completo (incluye el dsl) - para reabrir una plantilla guardada en el Diseñador o correrla en Vista previa. */
export async function getPrintReport(tenantId: string, id: string): Promise<PrintReportRecord> {
  return withTenant(tenantId, async (tx) => {
    const [row] = await tx
      .select()
      .from(printReports)
      .where(and(eq(printReports.id, id), eq(printReports.tenantId, tenantId)))
      .limit(1)
    if (!row) throw new PrintReportNotFoundError('No se encontró el reporte imprimible solicitado')
    return toRecord(row)
  })
}

export interface SavePrintReportInput {
  title: string
  dsl: PrintReportDsl
}

/** "Guardar reporte" del Diseñador - crea una plantilla nueva. */
export async function createPrintReport(tenantId: string, userId: string, input: SavePrintReportInput): Promise<PrintReportRecord> {
  const dsl = printReportDslSchema.parse(input.dsl)
  return withTenant(tenantId, async (tx) => {
    const [row] = await tx
      .insert(printReports)
      .values({ tenantId, createdBy: userId, title: input.title, baseEntitySlug: dsl.baseEntity, dsl })
      .returning()
    return toRecord(row)
  })
}

/** Actualiza una plantilla existente (título y/o dsl) - reutilizado por "Guardar cambios" del Diseñador al reabrir un reporte guardado. */
export async function updatePrintReport(tenantId: string, id: string, input: SavePrintReportInput): Promise<PrintReportRecord> {
  const dsl = printReportDslSchema.parse(input.dsl)
  return withTenant(tenantId, async (tx) => {
    const [row] = await tx
      .update(printReports)
      .set({ title: input.title, baseEntitySlug: dsl.baseEntity, dsl, updatedAt: new Date() })
      .where(and(eq(printReports.id, id), eq(printReports.tenantId, tenantId)))
      .returning()
    if (!row) throw new PrintReportNotFoundError('No se encontró el reporte imprimible solicitado')
    return toRecord(row)
  })
}

export async function deletePrintReport(tenantId: string, id: string): Promise<void> {
  return withTenant(tenantId, async (tx) => {
    const [row] = await tx
      .delete(printReports)
      .where(and(eq(printReports.id, id), eq(printReports.tenantId, tenantId)))
      .returning({ id: printReports.id })
    if (!row) throw new PrintReportNotFoundError('No se encontró el reporte imprimible solicitado')
  })
}

/** Corre el DSL (guardado o todavía sin guardar, ej. mientras se edita en el Diseñador) contra los datos vigentes - ver comentario largo de arriba sobre por qué nunca se congela un resultado. */
export async function previewPrintReport(tenantId: string, dsl: PrintReportDsl): Promise<PrintReportResult> {
  const parsed = printReportDslSchema.parse(dsl)
  return executePrintReport(tenantId, parsed)
}
