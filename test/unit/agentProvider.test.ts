import { afterEach, describe, expect, it, vi } from 'vitest'
import { completeJson } from '../../server/utils/aiProvider'
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs()})
describe('proveedor reutilizado por agente, sin red',()=>{
 it('JSON estructurado, presupuesto corto y tokens con fetch simulado',async()=>{
  vi.stubEnv('AI_PROVIDER','openai');vi.stubEnv('OPENAI_API_KEY','simulated');vi.stubEnv('OPENAI_MODEL','')
  const usage=vi.fn()
  const fetch=vi.fn(async(_url: unknown, _init: RequestInit)=>new Response(JSON.stringify({choices:[{message:{content:'{"intent":"guide"}'}}],usage:{prompt_tokens:20,completion_tokens:15}}),{status:200}));vi.stubGlobal('fetch',fetch)
  expect(await completeJson({system:'Reglas',prompt:'Datos',structured:true,model:'gpt-6-luna',maxTokens:400,timeoutMs:50,onUsage:usage})).toBe('{"intent":"guide"}')
  expect(fetch).toHaveBeenCalledOnce();const payload=JSON.parse(String(fetch.mock.calls[0]?.[1]?.body));expect(payload).toMatchObject({model:'gpt-6-luna',max_completion_tokens:400,temperature:0.2,response_format:{type:'json_object'}});expect(usage).toHaveBeenCalledWith(20,15)
 })
 it('timeout aborta el transporte simulado sin llamar a IA real',async()=>{
  vi.stubEnv('AI_PROVIDER','openai');vi.stubEnv('OPENAI_API_KEY','simulated')
  vi.stubGlobal('fetch',vi.fn((_url: unknown,init: RequestInit)=>new Promise((_resolve,reject)=>{init.signal!.addEventListener('abort',()=>reject(new Error('aborted')),{once:true})})))
  await expect(completeJson({system:'Reglas',prompt:'Datos',structured:true,timeoutMs:10})).rejects.toThrow('aborted')
 })
})
