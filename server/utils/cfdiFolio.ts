import { and, eq, sql } from 'drizzle-orm'
import type { db } from '~/server/db'
import { cfdiSeries } from '~/server/db/schema'

// Dominio fiscal fijo (DOCS/HU_Timbrado_CFDI_PAC.md, fase A): asignacion
// atomica de folio de CFDI por serie. MISMA garantia de concurrencia que
// nextCounterValue() de incrementalField.ts: el +1 se calcula EN el UPDATE
// (no leido y reescrito desde JS) y el row lock de Postgres serializa intentos
// concurrentes dentro de sus transacciones - dos timbrados simultaneos sobre
// la misma serie jamas consumen el mismo folio.
//
// Regla fiscal (fase D de la HU): el folio se consume SOLO cuando el intento
// de timbrado realmente avanza hacia el PAC. Esta funcion debe llamarse dentro
// de la misma transaccion que pasa el documento a estado `timbrando`; si una
// validacion previa falla (Zod, cuadre SAT, receptor incompleto), la
// transaccion se revierte y el folio NO se consume. Si la llamada al PAC
// falla despues de consumir folio, el folio queda gastado (preferido contra
// reutilizarlo: reusar folios tras un envio al PAC arriesga duplicados ante
// el SAT). El recovery de un estado colgado `timbrando` se resuelve con
// provider.getStatus antes de cualquier reintento (nunca re-timbrar a ciegas).

type Tx = typeof db

export class CfdiSerieUnavailableError extends Error {}

/**
 * Consume y devuelve el siguiente folio de la serie (numero, sin cero-pad:
 * el XML lo lleva como Folio numerico y la representacion "A-0001" es de UI).
 * Llamarse SIEMPRE dentro de withTenant(): la policy RLS de cfdi_series hace
 * que una serie de otro tenant sea invisible aqui - el UPDATE no matchea y
 * se corta con error en vez de consumir folio ajeno.
 */
export async function assignNextFolio(tx: Tx, serieId: string): Promise<number> {
  const [row] = await tx
    .update(cfdiSeries)
    .set({ nextFolio: sql`${cfdiSeries.nextFolio} + 1`, updatedAt: new Date() })
    .where(and(eq(cfdiSeries.id, serieId), eq(cfdiSeries.estado, 'activa')))
    .returning({ nextFolio: cfdiSeries.nextFolio })
  if (!row) {
    throw new CfdiSerieUnavailableError(
      'La serie fiscal no existe, no pertenece a esta organización o está inactiva'
    )
  }
  // RETURNING devuelve el valor POST-incremento; el folio asignado es el anterior.
  return row.nextFolio - 1
}
