import { client } from '~/server/db'

export const CRON_TRIGGER_RETRIES = 'cron:trigger-retries'
export const CRON_BILLING_USAGE = 'cron:billing-usage'
export const CRON_OLAP_ETL = 'cron:olap-etl'

export async function withSingleRunner<T>(name: string, fn: () => Promise<T>): Promise<{ ran: true; result: T } | { ran: false }> {
  // Usamos candado de transacción en vez de sesión porque en Vercel
  // conectamos a través del pooler de Neon en modo transacción.
  return client.begin(async (tx) => {
    const [{ locked }] = await tx`SELECT pg_try_advisory_xact_lock(hashtext(${name})) AS locked`
    if (!locked) {
      return { ran: false }
    }
    const result = await fn()
    return { ran: true, result }
  })
}
