export function databaseWarmupInterval(env: NodeJS.ProcessEnv = process.env) {
  const value = Number(env.DB_WARMUP_INTERVAL_SECONDS)
  return Number.isInteger(value) && value >= 60 ? value * 1000 : 0
}
/** Solo SELECT 1: nunca reintenta una escritura o una transacción de negocio. */
export async function probeDatabase(query: () => Promise<unknown>, delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))) {
  try { await query() } catch (error) {
    const code = (error as { code?: string; cause?: { code?: string } }).code ?? (error as { cause?: { code?: string } }).cause?.code
    if (!code || !['ECONNRESET','ECONNREFUSED','ETIMEDOUT','CONNECT_TIMEOUT','57P03'].includes(code)) throw error
    await delay(200); await query()
  }
}
