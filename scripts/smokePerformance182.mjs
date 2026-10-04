import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { request } from 'node:http'
import { readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import path from 'node:path'

/** HTTP de loopback al build: sin navegador; credenciales exclusivamente de fixture. */
export async function smokePerformance182(root, databaseUrl, credentials, secret) {
 if(!root.endsWith(`${path.sep}frontback-ci${path.sep}erd182-clean`) || !['localhost','127.0.0.1'].includes(new URL(databaseUrl).hostname)) throw new Error('Smoke solo local')
 const measurements=[]
 for(const enabled of [false,true]) {
  const port=await new Promise(resolve=>{const socket=createServer();socket.listen(0,'127.0.0.1',()=>{const address=socket.address();socket.close(()=>resolve(address.port))})})
  let output=''
  const server=spawn(process.execPath,[path.join(root,'.output/server/index.mjs')],{cwd:root,windowsHide:true,env:{...process.env,NODE_ENV:'production',NITRO_HOST:'127.0.0.1',NITRO_PORT:String(port),APP_DATABASE_URL:databaseUrl,NUXT_JWT_SECRET:secret,JWT_SECRET:secret,APP_BASE_URL:`http://127.0.0.1:${port}`,REQUEST_PERFORMANCE_ENABLED:String(enabled),DB_WARMUP_INTERVAL_SECONDS:'0',JOB_QUEUE_ENABLED:'false',OLAP_ETL_ENABLED:'false',TRIGGER_RETRY_ENABLED:'false',BILLING_USAGE_SNAPSHOTS_ENABLED:'false'},stdio:['ignore','pipe','pipe']})
  server.stdout.on('data',data=>{output+=data.toString()});server.stderr.on('data',data=>{output+=data.toString()})
  try {
   let ready=false
   for(let attempt=0;attempt<50;attempt++) {if(server.exitCode!==null)throw new Error('Build local no arrancó');try {const response=await fetch(`http://127.0.0.1:${port}/api/health`,{signal:AbortSignal.timeout(1000)});if(response.ok){ready=true;break}}catch(error){if(server.exitCode!==null)throw new Error('Build local terminó durante el sondeo')};await new Promise(resolve=>setTimeout(resolve,100))}
   if(!ready)throw new Error('Servidor local no está listo')
   const login=await new Promise((resolve,reject)=>{
    const body=JSON.stringify(credentials), req=request({hostname:'127.0.0.1',port,path:'/api/auth/login',method:'POST',headers:{'content-type':'application/json','content-length':Buffer.byteLength(body)}},response=>{
     let data='';response.on('data',chunk=>data+=chunk);response.on('end',()=>resolve({status:response.statusCode,timing:response.headers['server-timing'],cookies:response.headers['set-cookie'],data:JSON.parse(data)}))
    });req.on('error',reject);req.write(body.slice(0,1));setTimeout(()=>req.end(body.slice(1)),650)
   })
   if(login.status!==200 || login.data.requiresTotp!==false)throw new Error('Login sintético no completó sesión')
   if(enabled ? !login.timing?.includes('queries;desc="5"') : login.timing!==undefined) throw new Error('Instrumentación HTTP de login no coincide con conteo real')
   const cookie=(login.cookies??[]).map(value=>value.split(';')[0]).join('; ')
   const pages={}
   for(const route of ['/login','/']) {
    const response=await fetch(`http://127.0.0.1:${port}${route}`,{headers:route==='/'?{cookie}:{},redirect:'manual'})
    if(response.status!==200)throw new Error('Página local no respondió HTML esperado')
    const html=await response.text(), initial=new Set(), prefetched=new Set()
    for(const tag of html.matchAll(/<(?:link|script)\b[^>]*>/g)) {
     const file=/\b(?:href|src)="\/_nuxt\/([^"?]+\.js)/.exec(tag[0])?.[1]
     if(!file)continue
     if(tag[0].includes('rel="prefetch"'))prefetched.add(file)
     else if(tag[0].startsWith('<script') || tag[0].includes('rel="modulepreload"'))initial.add(file)
    }
    pages[route]={initialFiles:initial.size,initialGzip:[...initial].reduce((sum,file)=>sum+gzipSync(readFileSync(path.join(root,'.output/public/_nuxt',file))).length,0),prefetchFiles:prefetched.size}
    if(prefetched.size)throw new Error('HTML inicial todavía precarga rutas ajenas')
   }
   await new Promise(resolve=>setTimeout(resolve,100))
   const slow=output.split('\n').flatMap(line=>{try {const parsed=JSON.parse(line);return parsed.event==='slow_request'?[parsed]:[]}catch{return[]}})
   if(enabled ? !slow.some(row=>row.path==='/api/auth/login'&&row.queries===5&&row.totalMs>500) : slow.length!==0)throw new Error('Registro lento HTTP no cumple activación/umbral')
   for(const row of slow)if(Object.keys(row).some(key=>!['event','path','method','status','totalMs','queries','trips','databaseMs'].includes(key)))throw new Error('Registro lento contiene campos ajenos')
   measurements.push({enabled,timing:login.timing??null,slowRequests:slow,pages})
  } finally {if(server.exitCode===null){server.kill();await new Promise(resolve=>server.once('close',resolve))}}
 }
 return measurements
}
