import { z } from 'zod'
import { and, eq, gte, lte, sql as dsql, type SQL } from 'drizzle-orm'
import { withTenant } from '~/server/db'
import { dimCliente, dimSucursal, factEventos } from '~/server/db/schema'
import { toDimDateId } from '~/server/utils/olapEtl'
import { completeJson } from '~/server/utils/aiProvider'

// Épica ERD-46 (Reportería con IA): traduce la descripción en lenguaje
// natural de un reporte (Screen/Reportes - Nuevo reporte del .pen) a un DSL
// declarativo validado con Zod, y lo ejecuta sobre el esquema en estrella de
// HU-ERD-27/28 (dim_cliente/dim_sucursal/fact_eventos) - MISMO principio que
// server/utils/triggers.ts (ERD-48): nunca se genera ni ejecuta SQL de texto
// libre ni código arbitrario. La IA elige valores de un vocabulario cerrado
// (enums de abajo); el mapeo de cada valor a columnas/expresiones reales lo
// hace un switch controlado en este archivo, no la IA.
//
// Alcance deliberado (documentado, mismo criterio que la "lista plana Y/O"
// de triggers): un solo nivel de agrupación y hasta 4 medidas por reporte -
// cubre el caso de uso real mostrado en el propio mock ("Clientes con más de
// 3 pedidos... agrupados por sucursal" -> agrupar por sucursal, medir
// clientes/pedidos/monto) sin la complejidad de un DSL de BI completo
// (múltiples niveles de agrupación, joins arbitrarios, sub-consultas).

export const REPORT_GROUP_BY = ['tipoEvento', 'cliente', 'sucursal', 'day', 'month'] as const
export type ReportGroupBy = (typeof REPORT_GROUP_BY)[number]

export const REPORT_MEASURE_AGG = ['count', 'count_distinct_cliente', 'sum_monto', 'sum_cantidad'] as const
export type ReportMeasureAgg = (typeof REPORT_MEASURE_AGG)[number]

export const REPORT_CHART_TYPES = ['bar', 'line', 'pie'] as const
export type ReportChartType = (typeof REPORT_CHART_TYPES)[number]

const reportMeasureSchema = z
  .object({
    // snake_case simple: se usa tal cual como key de columna en el resultado
    // (fila -> { [measure.key]: valor }) y como key de React/Vue :key en la
    // tabla de vista previa - nunca se interpola en SQL.
    key: z
      .string()
      .min(1)
      .max(40)
      .regex(/^[a-z][a-z0-9_]*$/, 'key debe ser snake_case (ej. "total_clientes")'),
    label: z.string().min(1).max(60),
    agg: z.enum(REPORT_MEASURE_AGG)
  })
  .strict()

export const reportQueryDslSchema = z
  .object({
    title: z.string().min(1).max(120),
    chartType: z.enum(REPORT_CHART_TYPES),
    groupBy: z.enum(REPORT_GROUP_BY),
    measures: z.array(reportMeasureSchema).min(1).max(4),
    filters: z
      .object({
        tipoEvento: z.string().min(1).max(100).optional(),
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'from debe ser YYYY-MM-DD').optional(),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'to debe ser YYYY-MM-DD').optional()
      })
      .strict()
      .optional()
  })
  .strict()

export type ReportQueryDsl = z.infer<typeof reportQueryDslSchema>

export interface ReportResultRow {
  label: string
  [measureKey: string]: string | number
}

export interface ReportResult {
  columns: Array<{ key: string; label: string }>
  rows: ReportResultRow[]
}

/** Lanzado cuando la IA responde algo que no parsea como JSON o no matchea reportQueryDslSchema - se guarda el texto crudo (truncado) para diagnóstico, nunca se ejecuta nada de eso. */
export class AiResponseInvalidError extends Error {
  constructor(
    message: string,
    public readonly rawResponse: string
  ) {
    super(message)
  }
}

const REPORT_SYSTEM_PROMPT = `Sos un asistente que traduce pedidos de reportes en lenguaje natural a un JSON con una forma FIJA, para un sistema de reportería de un ERP. No generás SQL ni código: solo elegís valores de un vocabulario cerrado.

Devolvé SOLO un objeto JSON (sin texto adicional, sin markdown, sin explicaciones) con esta forma exacta:
{
  "title": string (título corto y descriptivo del reporte, en español),
  "chartType": "bar" | "line" | "pie",
  "groupBy": "tipoEvento" | "cliente" | "sucursal" | "day" | "month",
  "measures": [ { "key": string (snake_case, ej "total_clientes"), "label": string (en español), "agg": "count" | "count_distinct_cliente" | "sum_monto" | "sum_cantidad" } ] (entre 1 y 4 elementos),
  "filters": { "tipoEvento"?: string, "from"?: "YYYY-MM-DD", "to"?: "YYYY-MM-DD" } (opcional, omitir si no aplica)
}

Guía de agregaciones: "count" cuenta eventos/registros; "count_distinct_cliente" cuenta clientes distintos; "sum_monto" suma un importe/total en dinero; "sum_cantidad" suma una cantidad/unidades. Guía de agrupación: "tipoEvento" agrupa por el tipo de evento de negocio; "cliente" por cliente; "sucursal" por sucursal; "day"/"month" por fecha. Si el pedido menciona un tipo de evento concreto, usá exactamente uno de los valores reales listados en el catálogo (filters.tipoEvento) - si no coincide ningún valor real, omitilo.`

function buildReportPrompt(description: string, availableTipoEventos: string[]): string {
  const catalogo =
    availableTipoEventos.length > 0
      ? `Valores reales de tipo de evento disponibles en este tenant: ${availableTipoEventos.join(', ')}.`
      : 'Este tenant todavía no tiene eventos registrados - no hay valores reales de tipo de evento para filtrar.'
  return `${catalogo}\n\nPedido del usuario: "${description}"`
}

/** Quita un posible cerco de markdown (\`\`\`json ... \`\`\`) alrededor de la respuesta - algunos modelos lo agregan pese a la instrucción de no hacerlo. Exportada para test/unit/reportQuery.test.ts (mismo criterio que buildFieldType en HU-ERD-29: exportar un helper puro previamente privado solo para poder testearlo sin red/DB). */
export function stripMarkdownFence(text: string): string {
  const trimmed = text.trim()
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  return fenced ? fenced[1] : trimmed
}

/**
 * Llama al proveedor de IA configurado (server/utils/aiProvider.ts) y valida
 * su respuesta contra reportQueryDslSchema. Lanza AiProviderNotConfiguredError
 * (sin proveedor configurado) o AiResponseInvalidError (respuesta que no es
 * JSON válido, o no matchea la forma esperada) - nunca devuelve un DSL a
 * medio validar.
 */
export async function generateReportQueryDsl(description: string, availableTipoEventos: string[]): Promise<ReportQueryDsl> {
  const raw = await completeJson({
    system: REPORT_SYSTEM_PROMPT,
    prompt: buildReportPrompt(description, availableTipoEventos)
  })

  const cleaned = stripMarkdownFence(raw)
  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(cleaned)
  } catch {
    throw new AiResponseInvalidError('La IA no devolvió un JSON válido', raw.slice(0, 500))
  }

  const result = reportQueryDslSchema.safeParse(parsedJson)
  if (!result.success) {
    throw new AiResponseInvalidError('La IA devolvió un JSON con una forma inesperada', raw.slice(0, 500))
  }
  return result.data
}

function measureExpr(agg: ReportMeasureAgg): SQL<string | number> {
  switch (agg) {
    case 'count':
      return dsql<number>`count(*)::int`
    case 'count_distinct_cliente':
      return dsql<number>`count(distinct ${factEventos.clienteId})::int`
    case 'sum_monto':
      return dsql<string>`coalesce(sum(${factEventos.monto}), 0)::text`
    case 'sum_cantidad':
      return dsql<number>`coalesce(sum(${factEventos.cantidad}), 0)::int`
  }
}

function buildMeasureSelection(measures: ReportQueryDsl['measures']): Record<string, SQL<string | number>> {
  const selection: Record<string, SQL<string | number>> = {}
  for (const measure of measures) {
    selection[measure.key] = measureExpr(measure.agg)
  }
  return selection
}

function dateRangeConds(filters: ReportQueryDsl['filters']): SQL[] {
  const conds: SQL[] = []
  if (filters?.from) conds.push(gte(factEventos.dateId, toDimDateId(new Date(`${filters.from}T00:00:00.000Z`))))
  if (filters?.to) conds.push(lte(factEventos.dateId, toDimDateId(new Date(`${filters.to}T23:59:59.999Z`))))
  return conds
}

/**
 * Ejecuta un ReportQueryDsl ya validado contra el esquema en estrella del
 * tenant. Una consulta autocontenida por cada valor de `groupBy` (en vez de
 * un builder dinámico con joins condicionales) - mismo criterio de
 * simplicidad ya aplicado en server/utils/dashboardMetrics.ts (varias
 * consultas explícitas en vez de una mega-consulta genérica).
 */
export async function executeReportQuery(tenantId: string, dsl: ReportQueryDsl): Promise<ReportResult> {
  const columns = [{ key: 'label', label: 'Etiqueta' }, ...dsl.measures.map((m) => ({ key: m.key, label: m.label }))]
  const measureSelection = buildMeasureSelection(dsl.measures)

  return withTenant(tenantId, async (tx) => {
    const baseConds: SQL[] = [eq(factEventos.tenantId, tenantId), ...dateRangeConds(dsl.filters)]
    if (dsl.filters?.tipoEvento) baseConds.push(eq(factEventos.tipoEvento, dsl.filters.tipoEvento))

    let rows: Array<Record<string, unknown>>

    switch (dsl.groupBy) {
      case 'tipoEvento': {
        rows = await tx
          .select({ label: factEventos.tipoEvento, ...measureSelection })
          .from(factEventos)
          .where(and(...baseConds))
          .groupBy(factEventos.tipoEvento)
          .orderBy(dsql`count(*) desc`)
        break
      }
      case 'cliente': {
        rows = await tx
          .select({ label: dsql<string>`coalesce(${dimCliente.nombre}, 'Sin cliente')`, ...measureSelection })
          .from(factEventos)
          .leftJoin(dimCliente, eq(dimCliente.id, factEventos.clienteId))
          .where(and(...baseConds))
          .groupBy(dimCliente.id, dimCliente.nombre)
          .orderBy(dsql`count(*) desc`)
        break
      }
      case 'sucursal': {
        rows = await tx
          .select({ label: dsql<string>`coalesce(${dimSucursal.nombre}, 'Sin sucursal')`, ...measureSelection })
          .from(factEventos)
          .leftJoin(dimSucursal, eq(dimSucursal.id, factEventos.sucursalId))
          .where(and(...baseConds))
          .groupBy(dimSucursal.id, dimSucursal.nombre)
          .orderBy(dsql`count(*) desc`)
        break
      }
      case 'day': {
        rows = await tx
          .select({ label: dsql<string>`to_char(${factEventos.dateId}::text::date, 'YYYY-MM-DD')`, ...measureSelection })
          .from(factEventos)
          .where(and(...baseConds))
          .groupBy(factEventos.dateId)
          .orderBy(factEventos.dateId)
        break
      }
      case 'month': {
        // date_id es yyyymmdd (int) - el mes sale de dividir entero por 100 y
        // tomar modulo 100, sin necesitar un join a dim_date para esto.
        rows = await tx
          .select({ label: dsql<string>`to_char((${factEventos.dateId} / 100)::text || '01', 'YYYY-MM')`, ...measureSelection })
          .from(factEventos)
          .where(and(...baseConds))
          .groupBy(dsql`${factEventos.dateId} / 100`)
          .orderBy(dsql`${factEventos.dateId} / 100`)
        break
      }
    }

    return {
      columns,
      rows: rows.map((row) => {
        const out: ReportResultRow = { label: String(row.label ?? '') }
        for (const measure of dsl.measures) {
          const value = row[measure.key]
          out[measure.key] = typeof value === 'number' || typeof value === 'string' ? value : String(value ?? 0)
        }
        return out
      })
    }
  })
}
