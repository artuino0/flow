import { sql } from 'drizzle-orm'
import { db } from '~/server/db'
import { databaseWarmupInterval, probeDatabase } from '~/server/utils/databaseWarmup'

export default defineNitroPlugin(app => {
  const interval = databaseWarmupInterval(); if (!interval) return
  let running = false
  const timer = setInterval(async () => {
    if (running) return; running = true
    try { await probeDatabase(() => db.execute(sql`select 1`)) }
    catch { console.warn(JSON.stringify({ event: 'database_warmup_failed' })) }
    finally { running = false }
  }, interval)
  timer.unref()
  app.hooks.hook('close', () => clearInterval(timer))
})
