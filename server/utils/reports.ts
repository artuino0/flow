import { z } from 'zod'
import { and, eq, sql as dsql } from 'drizzle-orm'
import { withTenant } from '~/server/db'
import { factEventos, reports } from '~/server/db/schema'
import {
  executeReportQuery,
  generateReportQueryDsl,
  reportQueryDslSchema,
  type ReportQueryDsl,
  type ReportResult
} from '~/server/utils/reportQuery'

// Épica ERD-46 (Reportería con IA): orquestación de punta a punta - separada
// de los endpoints (server/api/reports/*.ts) para poder testearla sin pasar
// por HTTP, mismo patron que triggerAdmin.ts/moduleEntities.ts.

export class ReportNotFoundError extends Error {}

export interface ReportPreview {
  queryDsl: ReportQueryDsl
  result: ReportResult
}

/**
 * Valores reales de tipo_evento ya registrados por este tenant - se le pasan
 * a la IA como catálogo (ver server/utils/reportQuery.ts) para que, si el
 * pedido menciona un tipo de evento, elija uno que de verdad existe en vez
 * de inventar un valor que no matchearía ningún dato.
 */
async function listAvailableTipoEventos(tenantId: string): Promise<string[]> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx
      .selectDistinct({ tipoEvento: factEventos.tipoEvento })
      .from(factEventos)
      .where(eq(factEventos.tenantId, tenantId))
      .orderBy(factEventos.tipoEvento)
    return rows.map((r) => r.tipoEvento)
  })
}

/**
 * "Generar previsualización" (fiel al mock: NO persiste nada todavía). Pedir
 * el DSL a la IA y ejecutarlo son dos pasos independientes a propósito - un
 * DSL sintácticamente válido pero con, por ejemplo, un tipoEvento que no
 * existe simplemente da una previsualización vacía, no un error; el único
 * error real de este flujo es que la IA no configurada / no responda /
 * responda algo inválido.
 */
export async function previewReport(tenantId: string, description: string): Promise<ReportPreview> {
  const availableTipoEventos = await listAvailableTipoEventos(tenantId)
  const queryDsl = await generateReportQueryDsl(description, availableTipoEventos)
  const result = await executeReportQuery(tenantId, queryDsl)
  return { queryDsl, result }
}

const saveReportSchema = z.object({
  description: z.string().trim().min(1).max(2000),
  queryDsl: reportQueryDslSchema,
  // El resultado ya calculado por previewReport() - "Guardar reporte" guarda
  // la vista previa que el usuario efectivamente vio, no vuelve a ejecutar
  // la consulta (ver comentario largo en server/db/schema.ts sobre `reports`).
  resultSnapshot: z.object({
    columns: z.array(z.object({ key: z.string(), label: z.string() })),
    rows: z.array(z.record(z.string(), z.union([z.string(), z.number()])))
  })
})
export type SaveReportInput = z.infer<typeof saveReportSchema>

export async function saveReport(tenantId: string, userId: string, input: SaveReportInput) {
  const parsed = saveReportSchema.parse(input)
  return withTenant(tenantId, async (tx) => {
    const [row] = await tx
      .insert(reports)
      .values({
        tenantId,
        createdBy: userId,
        description: parsed.description,
        queryDsl: parsed.queryDsl,
        resultSnapshot: parsed.resultSnapshot
      })
      .returning()
    return row
  })
}

export async function getReport(tenantId: string, id: string) {
  return withTenant(tenantId, async (tx) => {
    const [row] = await tx
      .select()
      .from(reports)
      .where(and(eq(reports.id, id), eq(reports.tenantId, tenantId)))
      .limit(1)
    if (!row) throw new ReportNotFoundError('No se encontró el reporte solicitado')
    return row
  })
}

export interface ReportListItem {
  id: string
  description: string
  title: string
  createdAt: string
}

/** Listado simple (más nuevo primero) - sin mock propio todavía (el .pen solo diseñó "Nuevo reporte"), alcance mínimo para que un reporte guardado no quede inalcanzable. */
export async function listReports(tenantId: string): Promise<ReportListItem[]> {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx
      .select({ id: reports.id, description: reports.description, queryDsl: reports.queryDsl, createdAt: reports.createdAt })
      .from(reports)
      .where(eq(reports.tenantId, tenantId))
      .orderBy(dsql`${reports.createdAt} desc`)
    return rows.map((r) => ({
      id: r.id,
      description: r.description,
      title: (r.queryDsl as ReportQueryDsl)?.title ?? r.description,
      createdAt: r.createdAt.toISOString()
    }))
  })
}
