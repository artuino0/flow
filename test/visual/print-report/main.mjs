import { createApp, h, ref, computed } from 'vue'
import PrintReportPreview from '../../../components/PrintReportPreview.vue'
createApp({ setup() {
  const scenario = ref('grouped')
  const result = computed(() => {
    const numeric = scenario.value === 'numeric'
    const columns = [
      ...(!numeric ? [{ key: 'folio', label: 'Folio de recepción', kind: 'detalle' }, { key: 'productor', label: 'Productor / origen', kind: 'detalle' }, { key: 'cultivo', label: 'Cultivo y variedad', kind: 'detalle' }] : []),
      { key: 'recibidos', label: 'Peso recibido (kg)', kind: 'sumar' }, { key: 'empacados', label: 'Peso empacado (kg)', kind: 'sumar' }, { key: 'merma', label: 'Merma (kg)', kind: 'sumar' }
    ]
    const groups = ['Pimiento', 'Pepino', 'Tomate'].map((name, g) => {
      const rows = Array.from({length: scenario.value === 'short' ? 2 : 27}, (_, i) => ({values: { folio: `REC-2026-${String(g*27+i+1).padStart(4,'0')}`, productor: i%4 ? 'Agrícola Los Pinos' : 'Sociedad de Producción Rural del Valle de Culiacán', cultivo: `${name} · Calidad de exportación`, recibidos: 1240.5+i*10, empacados: 1190.25+i*10, merma: 50.25 }, isDeleted:false}))
      return {level:0,label:name,rows,children:[],subtotals:Object.fromEntries(['recibidos','empacados','merma'].map(key => [key,rows.reduce((sum,row)=>sum+row.values[key],0)]))}
    })
    const criteria = scenario.value === 'filtered' ? ['Productor: Agrícola Los Pinos', 'Fecha de recepción: 18–21 ago 2026'] : undefined
    return { title: 'Control de recepción y rendimiento de empaque', columns, groups: scenario.value === 'empty' ? [] : groups, ungroupedRows:[], grandTotals: Object.fromEntries(['recibidos','empacados','merma'].map(key=>[key,groups.reduce((sum,g)=>sum+g.subtotals[key],0)])), criteria }
  })
  // 'filtered' (2026-09-11): demuestra la Filters Strip nueva + el botón
  // "Cambiar filtros" del Top Bar (mock tCiL7/fz9a1 - ver PrintReportPreview.vue).
  return () => [h('div',{class:'fixture-controls'},['Datos de demostración · Validación visual',h('label',{},['Escenario ',h('select',{value:scenario.value,onChange:e=>scenario.value=e.target.value},[h('option',{value:'grouped'},'Varias páginas'),h('option',{value:'short'},'Reporte corto'),h('option',{value:'numeric'},'Solo importes'),h('option',{value:'empty'},'Sin registros'),h('option',{value:'filtered'},'Con filtros aplicados')])])]),h(PrintReportPreview,{title:result.value.title,result:result.value,loading:false,error:'',groupFieldLabels:['Cultivo'],generatedAt:new Date('2026-09-08T12:00:00'),hasParameters:scenario.value==='filtered'})]
}}).mount('#app')
