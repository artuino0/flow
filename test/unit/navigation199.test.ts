// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import * as vue from 'vue'
import { readFileSync } from 'node:fs'
import { compileVueComponent } from '../helpers/vueComponent'
import { loadNuxtSource183 } from '../helpers/nuxt183'
import { isSettingsNavigation, navigationEntities, unifiedAreas } from '../../utils/unifiedNavigation'
import * as model from '../../utils/unifiedNavigation'
import * as tours from '../../utils/onboardingTours'
const apps: vue.App[] = []
const flush = async () => { for(let i=0;i<12;i++) { await Promise.resolve(); await vue.nextTick() } }
afterEach(() => { apps.splice(0).forEach(app => app.unmount()); document.body.innerHTML=''; localStorage.clear(); vi.restoreAllMocks() })
const modules = Array.from({length:10},(_,i) => ({ id:String(i),name:'Módulo '+i,slug:'module-'+i,icon:null,moduleKind:'hecho',canCreate:i!==1 }))
const access = ['core','sites','automation','billing','communications'].map(key => ({key,enabled:true,accessible:true}))
it('composable real filtra permisos, limita Crear y conserva orden de anclados del servidor',async()=>{
  const permissions=vue.ref({apps:access}), saved=vue.ref({keys:['sites:all','unknown','entity:0']})
  const refresh=vi.fn(async()=>{}), fetch=vi.fn(async()=>({}))
  const globals={...vue,$fetch:fetch,useState:(_key:string,init:()=>unknown)=>vue.ref(init()),useAuth:()=>({user:vue.ref({isAdmin:true,country:'MX'})}),useChat:()=>({canAccess:vue.ref(true)}),useFlowAppAccess:()=>({data:permissions,load:async()=>{}}),useShellResource:(key:string)=>({data:key==='appnav-modules'?vue.ref({groups:[],unassigned:modules}):key==='navigation-pins'?saved:vue.ref({sites:[]}),execute:async()=>{},refresh})}
  const source=loadNuxtSource183('composables/useUnifiedNavigation.ts',globals,{'~/utils/unifiedNavigation':model})
  const useNavigation=source.useUnifiedNavigation as ()=>{quickCreate:vue.ComputedRef<typeof modules>;pinned:vue.ComputedRef<model.NavigationLink[]>;togglePin:(key:string)=>Promise<void>}
  const nav=useNavigation()
  expect(nav.quickCreate.value.map(item=>item.id)).toEqual(['0','2','3','4','5','6','7','8'])
  expect(nav.pinned.value.map(item=>item.key)).toEqual(['sites:all','entity:0'])
  await nav.togglePin('sites:all');expect(fetch).toHaveBeenCalledWith('/api/navigation/pins',{method:'PUT',body:{key:'sites:all',pinned:false}});expect(refresh).toHaveBeenCalledOnce()
  permissions.value={apps:access.map(app=>({...app,accessible:app.key!=='core'}))}
  expect(nav.quickCreate.value).toEqual([]);expect(nav.pinned.value.map(item=>item.key)).toEqual(['sites:all'])
})
it('áreas respetan activación, permisos, administrador y país',() => {
  const areas = unifiedAreas(access,modules,false,'US',false,true)
  expect(areas.find(area => area.key==='sites')?.items).toHaveLength(7)
  expect(areas.find(area => area.key==='sites')?.pending).toBe(true)
  expect(areas.filter(area => area.accessible).map(area => area.key)).toEqual(['core','sites'])
  expect(unifiedAreas(access.map(app => ({...app,enabled:app.key!=='sites'})),modules,true,'MX',true).find(area => area.key==='sites')?.enabled).toBe(false)
})
it('mantiene orden de módulos agrupados y subprocesos antes de los no asignados',() => {
  expect(navigationEntities({groups:[{id:'g',name:'Área',icon:null,modules:[modules[3]!],catalogs:[],children:[{id:'c',name:'Proceso',icon:null,modules:[modules[2]!],catalogs:[],children:[]}]}],unassigned:[modules[0]!]}).map(entity => entity.id)).toEqual(['3','2','0'])
})
it.each(['/ajustes','/modulos/nuevo','/organizacion','/disenador','/catalogos/editar','/usuarios','/roles'])('menú de ajustes por ruta %s',path => expect(isSettingsNavigation(path)).toBe(true))
it('Sites y Chat conservan la barra normal',() => { expect(isSettingsNavigation('/sites/123/pages')).toBe(false); expect(isSettingsNavigation('/chat')).toBe(false) })
async function mount(file: string, path='/', permitted=access, props={}) {
  const route = vue.reactive({path,fullPath:path,params:{},query:{}}), keys=vue.ref<string[]>([])
  const areas = vue.computed(() => unifiedAreas(permitted,modules,true,'MX',true,true))
  const pinned = vue.computed(() => areas.value.filter(area => area.enabled && area.accessible).flatMap(area => area.items).filter(item => keys.value.includes(item.key)))
  const togglePin = vi.fn(async (key:string) => { keys.value=keys.value.includes(key)?keys.value.filter(value => value!==key):[...keys.value,key] })
  const state = {areas,pinned,togglePin,pinBusy:vue.ref(false),pinError:vue.ref(''),pins:{execute:async()=>{}},load:async()=>{},nav:{data:vue.ref({groups:[],unassigned:modules}),execute:async()=>{}},quickCreate:vue.ref(modules.filter(entity => entity.canCreate).slice(0,8))}
  const globals = {...vue,useRoute:()=>route,useState:(_key:string,init:()=>unknown)=>vue.ref(init()),useId:()=> 'test-id',useUnifiedNavigation:()=>state,useOnboarding:()=>({navigationTourId:vue.ref(null)}),useIsAdmin:async()=>({data:vue.ref(true)}),useAuth:()=>({user:vue.ref({isAdmin:true,country:'MX'})}),useDesignerPlanUsage:()=>({data:vue.ref({code:'pro'})})}
  const icon={render:()=>vue.h('svg')}, group={render:()=>null}
  const imports={'~/utils/unifiedNavigation':model,'~/utils/onboardingTours':tours,'~/utils/moduleIcons':{moduleIconComponent:()=>icon},'~/components/AppNavGroup.vue':group,'~/components/AppNavEntity.vue':group}
  const compile=(name:string)=>compileVueComponent(name,imports,globals)
  const host=document.createElement('div');document.body.append(host)
  const app=vue.createApp({render:()=>vue.h(vue.Suspense,null,{default:()=>vue.h(compile(file),props)})})
  app.component('NuxtLink',vue.defineComponent({props:['to'],setup:(props,{slots})=>()=>vue.h('a',{href:props.to},slots.default?.())}))
  app.component('AppNavTooltip',vue.defineComponent({setup:(_, {slots})=>()=>vue.h('div',slots.default?.())}))
  app.component('SidebarPlanUsage',{render:()=>null})
  for(const name of ['NavigationMore','NavigationPinnedItem','QuickCreate']) app.component(name,compile('components/'+name+'.vue'))
  app.mount(host);apps.push(app);await flush();return {host,route,keys,state,togglePin}
}
it('barra normal contiene Tablero y todos los grupos accesibles; no contiene Chat fijo ni Ajustes',async()=>{
  localStorage.setItem('flow-nav-closed',JSON.stringify({sites:false,automation:false,billing:false}))
  const {host}=await mount('components/AppNav.vue')
  expect(host.querySelector('a[href="/"]')?.textContent).toContain('Tablero')
  expect(host.textContent).toContain('Sites');expect(host.textContent).toContain('Automatización');expect(host.textContent).toContain('Facturación')
  expect(host.querySelector('a[href="/chat"]')).toBeNull();expect(host.querySelector('a[href="/ajustes?section=perfil"]')).toBeNull()
  expect(host.querySelector('button[aria-label="Más"]')).toBeTruthy()
})
it('Sites, Automatización y Facturación inician plegados; Anclados sigue abierto',async()=>{
  const {host,keys}=await mount('components/AppNav.vue')
  keys.value=['sites:all']
  await flush()
  const headings=[...host.querySelectorAll<HTMLButtonElement>('button[aria-expanded]')]
  const expanded=(label:string)=>headings.find(button=>button.textContent?.trim()===label)?.getAttribute('aria-expanded')
  expect(expanded('Sites')).toBe('false')
  expect(expanded('Automatización')).toBe('false')
  expect(expanded('Facturación')).toBe('false')
  expect(host.textContent).toContain('ANCLADOS')
  expect(host.textContent).toContain('ANCLADOS')
})
it('abre el grupo de la ruta actual sin sobrescribir la preferencia guardada',async()=>{
  const saved={sites:true,automation:true,billing:false}
  localStorage.setItem('flow-nav-closed',JSON.stringify(saved))
  const {host}=await mount('components/AppNav.vue','/sites/pages')
  const sites=[...host.querySelectorAll<HTMLButtonElement>('button[aria-expanded]')].find(button=>button.textContent?.trim()==='Sites')
  expect(sites?.getAttribute('aria-expanded')).toBe('true')
  expect(host.querySelector('a[href="/sites/pages"]')).toBeTruthy()
  expect(JSON.parse(localStorage.getItem('flow-nav-closed')||'{}')).toEqual(saved)
})
it('mantiene Más en el pie, fuera del contenedor con scroll',async()=>{
  const {host}=await mount('components/AppNav.vue','/',access,{compact:true})
  const more=host.querySelector('button[aria-label="Más"]')
  expect(more).toBeTruthy()
  expect(host.querySelector('.sidebar-scroll')?.contains(more)).toBe(false)
})
it('los grupos de Core inician abiertos si no hay preferencia guardada',async()=>{
  const group={id:'core',name:'Core',icon:'Blocks',modules:[modules[0]!],catalogs:[],children:[]}
  const {host}=await mount('components/AppNavGroup.vue','/',access,{group,compact:false})
  const trigger=host.querySelector<HTMLButtonElement>('button[aria-label="Core"]')
  expect(trigger?.getAttribute('aria-expanded')).toBe('true')
})
it('los grupos de Core conservan la preferencia guardada',async()=>{
  localStorage.setItem('flowerp-group-core','closed')
  const group={id:'core',name:'Core',icon:'Blocks',modules:[modules[0]!],catalogs:[],children:[]}
  const {host}=await mount('components/AppNavGroup.vue','/',access,{group,compact:false})
  const trigger=host.querySelector<HTMLButtonElement>('button[aria-label="Core"]')
  expect(trigger?.getAttribute('aria-expanded')).toBe('false')
  expect(localStorage.getItem('flowerp-group-core')).toBe('closed')
})
it('Ajustes muestra menú previo y Volver; conserva anclados al volver',async()=>{
  const {host,route,keys}=await mount('components/AppNav.vue','/ajustes')
  keys.value=['sites:all'];await flush()
  expect(host.textContent).toContain('Administrar aplicaciones');expect(host.textContent).toContain('Mi perfil');expect(host.querySelector('[aria-label="Volver a la navegación"]')).toBeTruthy()
  expect(host.querySelector('button[aria-label="Más"]')).toBeNull()
  route.path='/';route.fullPath='/';await flush();expect(host.textContent).toContain('ANCLADOS')
})
it('Más: candados, teclado, alfiler, Escape devuelve foco y clic fuera cierra',async()=>{
  Object.defineProperty(window,'innerWidth',{value:1440,configurable:true})
  vi.spyOn(HTMLElement.prototype,'getClientRects').mockReturnValue([{width:1}] as unknown as DOMRectList)
  const {host,togglePin}=await mount('components/NavigationMore.vue','/',access.map(app=>({...app,enabled:app.key!=='billing',accessible:app.key!=='automation'})))
  const trigger=host.querySelector<HTMLButtonElement>('button')!;trigger.click();await flush()
  const panel=document.querySelector('[role="dialog"]')!
  expect(panel.textContent).toContain('No activada');expect(panel.textContent).toContain('Sin permiso');expect(panel.textContent).toContain('Configuración pendiente')
  const first=panel.querySelector<HTMLButtonElement>('[data-area="core"]')!;first.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));await flush()
  expect((document.activeElement as HTMLElement).dataset.area).toBe('sites')
  document.activeElement!.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));await flush()
  expect(document.activeElement?.getAttribute('href')).toBe('/sites')
  panel.querySelector<HTMLButtonElement>('[aria-label="Anclar Todos los sitios"]')!.click();await flush();expect(togglePin).toHaveBeenCalledWith('sites:all')
  panel.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await flush();expect(document.querySelector('[role="dialog"]')).toBeNull();expect(document.activeElement).toBe(trigger)
  trigger.click();await flush();document.body.dispatchEvent(new Event('pointerdown',{bubbles:true}));await flush();expect(document.querySelector('[role="dialog"]')).toBeNull()
})
it('Crear rápido ofrece como máximo ocho módulos autorizados y se oculta sin ellos',async()=>{
  const {host,state}=await mount('components/QuickCreate.vue')
  host.querySelector<HTMLButtonElement>('button')!.click();await flush()
  const links=[...host.querySelectorAll('a')];expect(links).toHaveLength(8);expect(links.some(link=>link.getAttribute('href')==='/registros/module-1/nuevo')).toBe(false)
  state.quickCreate.value=[];await flush();expect(host.querySelector('button')).toBeNull()
})
it('menú de anclado permite desanclar y devuelve el foco',async()=>{
  const item=unifiedAreas(access,modules,true,'MX',true)[1]!.items[0]!
  const {host,keys,togglePin}=await mount('components/NavigationPinnedItem.vue','/',access,{item})
  keys.value=[item.key];await flush()
  const trigger=host.querySelector<HTMLButtonElement>('button')!;trigger.click();await flush()
  document.querySelector<HTMLButtonElement>('[role="menu"] button')!.click();await flush()
  expect(togglePin).toHaveBeenCalledWith(item.key);expect(keys.value).toEqual([])
  expect(document.querySelector('[role="menu"]')).toBeNull();expect(document.activeElement).toBe(trigger)
})
it('Más móvil muestra una columna y permite volver a las áreas',async()=>{
  Object.defineProperty(window,'innerWidth',{value:390,configurable:true})
  const {host}=await mount('components/NavigationMore.vue')
  host.querySelector<HTMLButtonElement>('button')!.click();await flush()
  const panel=document.querySelector('[role="dialog"]')!
  expect(panel.querySelector('[data-column="items"]')?.className).toContain('hidden sm:block')
  panel.querySelector<HTMLButtonElement>('[data-area="sites"]')!.click();await flush()
  expect(panel.querySelector('[data-column="areas"]')?.className).toContain('hidden sm:block')
  panel.querySelector<HTMLButtonElement>('[data-column="items"] button')!.click();await flush()
  expect(panel.querySelector('[data-column="areas"]')?.className).not.toContain('hidden sm:block')
})
it('layout conserva tours, engrane entre notificaciones y tema, y ancho fijo 240/64',()=>{
  const source=readFileSync('layouts/default.vue','utf8')
  expect(source).not.toContain('FlowAppLauncher');expect(source).not.toContain('activeKey')
  expect(source).toContain("sidebarCollapsed ? 'w-16' : 'w-60'")
  for(const tour of ['menu','account','account-menu','account-settings'])expect(source).toContain(`data-tour="${tour}"`)
  expect(source.indexOf('aria-label="Ajustes"')).toBeGreaterThan(source.indexOf('<NotificationCenter'))
  expect(source.indexOf('aria-label="Ajustes"')).toBeLessThan(source.indexOf('<ThemeSelector'))
})
