import { describe, it, expect } from 'vitest'
import { reportQueryDslSchema, stripMarkdownFence, generateReportQueryDsl, AiProviderNotConfiguredError } from '../../server/utils/reportQuery'

// Épica ERD-46 (Reportería con IA): pruebas puras (sin Postgres, sin red),
// mismo criterio que test/unit/triggerConditions.test.ts para el DSL de
// triggers (ERD-48) - reportQueryDslSchema es el mismo tipo de "vocabulario
// cerrado" validado con Zod (nunca SQL/código libre), así que se prueban los
// mismos tipos de caso: forma válida, enums inválidos, límites de measures,
// y el rechazo de campos extra (.strict()) que un modelo de IA podría
// agregar de más.

const validDsl = {
  title: 'Clientes por sucursal',
  chartType: 'bar' as const,
  groupBy: 'sucursal' as const,
  measures: [{ key: 'total_clientes', label: 'Clientes', agg: 'count_distinct_cliente' as const }]
}

describe('reportQueryDslSchema', () => {
  it('acepta un DSL válido mínimo', () => {
    const result = reportQueryDslSchema.safeParse(validDsl)
    expect(result.success).toBe(true)
  })

  it('acepta filters opcionales (tipoEvento/from/to)', () => {
    const result = reportQueryDslSchema.safeParse({
      ...validDsl,
      filters: { tipoEvento: 'pedido_creado', from: '2026-01-01', to: '2026-01-31' }
    })
    expect(result.success).toBe(true)
  })

  it('rechaza un groupBy fuera del enum cerrado', () => {
    const result = reportQueryDslSchema.safeParse({ ...validDsl, groupBy: 'region' })
    expect(result.success).toBe(false)
  })

  it('rechaza un chartType fuera del enum cerrado', () => {
    const result = reportQueryDslSchema.safeParse({ ...validDsl, chartType: 'scatter' })
    expect(result.success).toBe(false)
  })

  it('rechaza una agregación fuera del enum cerrado (nunca SQL libre)', () => {
    const result = reportQueryDslSchema.safeParse({
      ...validDsl,
      measures: [{ key: 'x', label: 'X', agg: 'sum(monto * 2)' }]
    })
    expect(result.success).toBe(false)
  })

  it('rechaza measures vacío', () => {
    const result = reportQueryDslSchema.safeParse({ ...validDsl, measures: [] })
    expect(result.success).toBe(false)
  })

  it('rechaza más de 4 measures', () => {
    const measure = { key: 'm', label: 'M', agg: 'count' as const }
    const result = reportQueryDslSchema.safeParse({ ...validDsl, measures: [measure, measure, measure, measure, measure] })
    expect(result.success).toBe(false)
  })

  it('rechaza una key de measure que no es snake_case', () => {
    const result = reportQueryDslSchema.safeParse({
      ...validDsl,
      measures: [{ key: 'Total Clientes', label: 'Clientes', agg: 'count' }]
    })
    expect(result.success).toBe(false)
  })

  it('rechaza un formato de fecha inválido en filters.from', () => {
    const result = reportQueryDslSchema.safeParse({ ...validDsl, filters: { from: '01/01/2026' } })
    expect(result.success).toBe(false)
  })

  it('rechaza campos extra no declarados (.strict, mismo criterio que triggers)', () => {
    const result = reportQueryDslSchema.safeParse({ ...validDsl, sql: 'select * from users' })
    expect(result.success).toBe(false)
  })
})

describe('stripMarkdownFence', () => {
  it('deja pasar un JSON sin cerco tal cual', () => {
    expect(stripMarkdownFence('{"a":1}')).toBe('{"a":1}')
  })

  it('quita un cerco ```json ... ```', () => {
    expect(stripMarkdownFence('```json\n{"a":1}\n```')).toBe('{"a":1}')
  })

  it('quita un cerco ``` ... ``` sin el tag "json"', () => {
    expect(stripMarkdownFence('```\n{"a":1}\n```')).toBe('{"a":1}')
  })

  it('recorta espacios en blanco alrededor', () => {
    expect(stripMarkdownFence('  \n{"a":1}\n  ')).toBe('{"a":1}')
  })
})

describe('generateReportQueryDsl', () => {
  it('lanza AiProviderNotConfiguredError si AI_PROVIDER no está configurado - nunca un fallback silencioso', async () => {
    const previous = process.env.AI_PROVIDER
    delete process.env.AI_PROVIDER
    try {
      await expect(generateReportQueryDsl('clientes por sucursal', [])).rejects.toBeInstanceOf(AiProviderNotConfiguredError)
    } finally {
      if (previous === undefined) delete process.env.AI_PROVIDER
      else process.env.AI_PROVIDER = previous
    }
  })
})
