import { z } from 'zod'

// HU-ERD-61: fiscal_data varia por pais, por eso vive en un jsonb (mismo
// patron que entity_fields.validation_rules) en vez de columnas fijas.
// Por ahora solo se valida el caso Mexico; para cualquier otro country se
// acepta cualquier objeto (no hay catalogo definido todavia).

// Validacion de FORMATO, no de existencia real ante el SAT: 3-4 letras +
// 6 digitos (fecha AAMMDD) + 3 alfanumericos (homoclave). Cubre persona
// moral (12) y persona fisica (13).
const RFC_REGEX = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/
const CODIGO_POSTAL_REGEX = /^\d{5}$/

export const mxFiscalDataSchema = z
  .object({
    rfc: z.string().regex(RFC_REGEX, 'RFC con formato invalido').nullable().optional(),
    regimenFiscal: z.string().min(1, 'Regimen fiscal requerido').nullable().optional(),
    codigoPostal: z.string().regex(CODIGO_POSTAL_REGEX, 'Codigo postal invalido').nullable().optional(),
    calle: z.string().nullable().optional(),
    numeroExterior: z.string().nullable().optional(),
    numeroInterior: z.string().nullable().optional(),
    colonia: z.string().nullable().optional(),
    municipio: z.string().nullable().optional(),
    estado: z.string().nullable().optional()
  })
  .strict()

const genericFiscalDataSchema = z.record(z.string(), z.unknown())

export function getFiscalDataSchema(country: string): z.ZodTypeAny {
  return country === 'MX' ? mxFiscalDataSchema : genericFiscalDataSchema
}

export const tenantUpdateSchema = z
  .object({
    name: z.string().min(1).optional(),
    email: z.string().email().nullable().optional(),
    phone: z.string().nullable().optional(),
    defaultCurrency: z.string().length(3).optional(),
    timezone: z.string().min(1).optional(),
    country: z.string().length(2).optional(),
    fiscalData: z.record(z.string(), z.unknown()).optional()
  })
  .superRefine((body, ctx) => {
    if (body.fiscalData === undefined) return
    const schema = getFiscalDataSchema(body.country ?? 'MX')
    const result = schema.safeParse(body.fiscalData)
    if (!result.success) {
      for (const issue of result.error.issues) {
        ctx.addIssue({ ...issue, path: ['fiscalData', ...issue.path] })
      }
    }
  })
