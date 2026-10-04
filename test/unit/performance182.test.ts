import { afterEach, expect, it, vi } from 'vitest'
import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import { createEvent } from 'h3'
import { readFileSync } from 'node:fs'
import { performanceEnabled, performanceHeader, performanceSummary, newRequestPerformance, performanceScope, normalizedPerformancePath } from '../../server/utils/requestPerformance'
import { databaseWarmupInterval, probeDatabase } from '../../server/utils/databaseWarmup'
import { cachedTenantMetadata, invalidateTenantAccess, metadataCache } from '../../server/utils/shortCache'
import { MODULE_ICON_KEYS } from '../../server/utils/moduleIcons'
import paths from '../../utils/moduleIconPaths.json'

afterEach(() => { vi.unstubAllEnvs(); metadataCache.clear() })
it('plugin emite cabecera y registro lento solo al habilitarlo, sin query o PII', async () => {
  const hooks = new Map<string, (event: ReturnType<typeof createEvent>) => void>()
  vi.stubGlobal('defineNitroPlugin', (callback: unknown) => callback)
  const plugin = (await import('../../server/plugins/request-performance')).default
  plugin({ hooks: { hook: (name: string, callback: (event: ReturnType<typeof createEvent>) => void) => hooks.set(name, callback) } } as unknown as Parameters<typeof plugin>[0])
  const req=new IncomingMessage(new Socket()); req.url='/api/records/privado?email=persona@privada.local'; req.method='GET'
  const event=createEvent(req,new ServerResponse(req)), info=vi.spyOn(console,'info').mockImplementation(()=>{})
  vi.stubEnv('NODE_ENV','production'); vi.stubEnv('REQUEST_PERFORMANCE_ENABLED','false')
  hooks.get('request')!(event); hooks.get('beforeResponse')!(event); hooks.get('afterResponse')!(event)
  expect(event.node.res.getHeader('Server-Timing')).toBeUndefined(); expect(info).not.toHaveBeenCalled()
  vi.stubEnv('REQUEST_PERFORMANCE_ENABLED','true'); hooks.get('request')!(event)
  const metrics=event.context.requestPerformance as ReturnType<typeof newRequestPerformance>; metrics.start=performance.now()-600
  hooks.get('beforeResponse')!(event); hooks.get('afterResponse')!(event)
  expect(event.node.res.getHeader('Server-Timing')).toContain('queries;desc="0"')
  expect(JSON.parse(info.mock.calls[0]![0])).toMatchObject({event:'slow_request',path:'/api/records/:value',queries:0,status:200})
  expect(info.mock.calls[0]![0]).not.toContain('privad')
  metrics.start=performance.now(); hooks.get('afterResponse')!(event)
  expect(info).toHaveBeenCalledTimes(1); info.mockRestore(); vi.unstubAllGlobals()
})
it('medición apagada por defecto en producción, activa en desarrollo o por opción explícita', () => {
  expect(performanceEnabled({ NODE_ENV:'production' })).toBe(false)
  expect(performanceEnabled({ NODE_ENV:'development', REQUEST_PERFORMANCE_ENABLED:'false' })).toBe(true)
  expect(performanceEnabled({ NODE_ENV:'production', REQUEST_PERFORMANCE_ENABLED:'true' })).toBe(true)
})
it('resumen y Server-Timing no contienen datos, ids, slugs, tokens ni query', () => {
  const req=new IncomingMessage(new Socket()); req.url='/api/records/cliente-secreto/123?token=privado&email=a@b.local'; req.method='GET'
  const event=createEvent(req,new ServerResponse(req)), metrics={ start:10, queries:4, trips:8, databaseMs:420.5 }
  expect(performanceSummary(event,metrics,610)).toEqual({ event:'slow_request',path:'/api/records/:value/:value',method:'GET',status:200,totalMs:600,queries:4,trips:8,databaseMs:421 })
  expect(performanceHeader(metrics,610)).toBe('app;dur=600.0, db;dur=420.5, queries;desc="4", trips;desc="8"')
  expect(normalizedPerformancePath('/api/sites/nombre-privado/pages/id-privado')).toBe('/api/sites/:value/pages/:value')
})
it('contextos concurrentes de medición permanecen separados', async () => {
  const a=newRequestPerformance(), b=newRequestPerformance()
  await Promise.all([performanceScope(a,async()=>{ await Promise.resolve(); a.queries++ }),performanceScope(b,async()=>{ await Promise.resolve(); b.queries+=3 })])
  expect(a.queries).toBe(1); expect(b.queries).toBe(3)
})
it('caché no guarda lecturas que cruzan una invalidación', async () => {
  const save=vi.spyOn(metadataCache,'set') // Comprueba el descarte aunque la suite desactive TTL.
  let release: (value: { name:string }) => void = () => {}
  const pending = cachedTenantMetadata('a','role:1',()=>new Promise<{ name:string }>(resolve=>{release=resolve}))
  invalidateTenantAccess('a'); release({name:'viejo'}); await pending
  expect(save).not.toHaveBeenCalled(); expect(metadataCache.get('a:role:1')).toBeUndefined(); save.mockRestore()
})
it('warmup optativo, mínimo 60 s y reintento solo de conexiones en SELECT 1', async () => {
  expect(databaseWarmupInterval({})).toBe(0); expect(databaseWarmupInterval({ DB_WARMUP_INTERVAL_SECONDS:'59' })).toBe(0); expect(databaseWarmupInterval({ DB_WARMUP_INTERVAL_SECONDS:'120' })).toBe(120000)
  const query=vi.fn().mockRejectedValueOnce(Object.assign(new Error('local'),{code:'ECONNRESET'})).mockResolvedValueOnce(undefined), delay=vi.fn(async()=>{})
  await probeDatabase(query,delay); expect(query).toHaveBeenCalledTimes(2); expect(delay).toHaveBeenCalledWith(200)
  const invalid=vi.fn().mockRejectedValue(Object.assign(new Error('local'),{code:'28P01'}))
  await expect(probeDatabase(invalid,delay)).rejects.toMatchObject({code:'28P01'}); expect(invalid).toHaveBeenCalledTimes(1)
})
it('cada clave del catálogo conserva su archivo y glifo originales', () => {
  expect(Object.keys(paths).sort()).toEqual([...MODULE_ICON_KEYS].sort())
  for(const [key,file] of Object.entries(paths)) {
    expect(file).not.toContain('..')
    const original=readFileSync(new URL(`../../node_modules/@lucide/vue/dist/esm/icons/${file}`,import.meta.url),'utf8')
    expect(original).toContain(`${key} as default`)
  }
})
