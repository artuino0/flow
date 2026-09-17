import type { ZodError } from 'zod'
import { CfdiDocumentError } from '~/server/utils/cfdiDocuments'
import { PacNotConfiguredError } from '~/server/utils/pacSettings'

// Traductor único de errores del dominio fiscal a HTTP, para que ningún
// endpoint devuelva un ZodError crudo (bug ya vivido en 0.79.1 con la vista
// previa del Diseñador) ni deje pasar PacNotConfiguredError como 500.

export function zodIssueMessage(error: ZodError): string {
  const issue = error.issues[0]
  if (!issue) return 'Datos inválidos'
  const campo = issue.path.join('.')
  return campo ? `${campo}: ${issue.message}` : issue.message
}

export function failCfdi(err: unknown): never {
  if (err instanceof CfdiDocumentError) {
    throw createError({ statusCode: err.statusCode, statusMessage: err.message })
  }
  if (err instanceof PacNotConfiguredError) {
    throw createError({ statusCode: 422, statusMessage: 'Configura el PAC en Ajustes → Facturación antes de timbrar' })
  }
  throw err
}
