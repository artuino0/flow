import { readFileSync, writeFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
const root = process.cwd(), stage = process.argv[2] ?? 'after'
const copyName = path.basename(root)
if (!['erd182-clean', 'erd183-clean'].includes(copyName) || path.basename(path.dirname(root)) !== 'frontback-ci') throw new Error('Ejecutar en la copia limpia')
const manifest = (await import(pathToFileURL(path.join(root, '.nuxt/dist/server/client.manifest.mjs')).href)).default
const closure = keys => {
 const seen = new Set(), files = new Set()
 const visit = key => { if (seen.has(key)) return; seen.add(key); const item=manifest[key]; if(!item)return; if(item.file.endsWith('.js')) files.add(item.file); for(const dependency of item.imports??[]) visit(dependency) }
 keys.forEach(visit)
 return [...files].map(file=>({file,gzip:gzipSync(readFileSync(path.join(root,'.output/public/_nuxt',file))).length}))
}
const entryKey = Object.keys(manifest).find(key=>manifest[key].isEntry)
if (!entryKey) throw new Error('Manifiesto sin entrada')
const metrics = {}
for (const [name, keys] of [['entry',[entryKey]],['login',[entryKey,'pages/login.vue']],['home',[entryKey,'pages/index.vue',...Object.keys(manifest).filter(key=>manifest[key].src==='layouts/default.vue')]]]) {
 const files=closure(keys); metrics[name]={gzip:files.reduce((sum,item)=>sum+item.gzip,0),files}
}
console.log(JSON.stringify(metrics,null,2))
const docs='C:/desarrollo/ERP-Dinamico/DOCS/tareas'
writeFileSync(`${docs}/${copyName.split('-')[0]}-bundle-${stage}.json`,JSON.stringify(metrics,null,2))
if(stage==='after') {
 const baseline=JSON.parse(readFileSync(path.join(root,'scripts/performance182-baseline.json'),'utf8')).bundle
 for(const name of ['entry','login','home']) if(metrics[name].gzip>baseline[name]*1.1) throw new Error(`Presupuesto ${name}: crecimiento superior al 10%`)
 if(metrics.entry.gzip>150*1024) throw new Error('Entrada supera 150 KiB gzip')
}
