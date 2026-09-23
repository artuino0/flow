<script setup lang="ts">
import { Plus, Trash2, Search, ArrowLeft } from '@lucide/vue'
import {
  EXPORTACION,
  FORMAS_PAGO,
  IMPUESTOS_PRESET,
  METODOS_PAGO,
  REGIMENES_FISCALES,
  TIPOS_RELACION,
  USOS_CFDI,
  formatoDinero
} from '~/utils/cfdiCatalogos'

// Fase C/E de DOCS/HU_Timbrado_CFDI_PAC.md: captura del documento fiscal.
// tipo=I|E: factura/nota de crédito con conceptos (los totales los recalcula
// el servidor — la vista previa de aquí usa la misma aritmética). tipo=P:
// complemento de pagos generado desde un cobro aplicado del mundo dinámico.
// ?id= entra en modo edición (solo borradores/error sin timbrar).
definePageMeta({ layout: 'default' })

const route = useRoute()
const router = useRouter()
const toast = useToast()

const tipo = ref<'I' | 'E' | 'P'>(['I', 'E', 'P'].includes(String(route.query.tipo)) ? (String(route.query.tipo) as 'I' | 'E' | 'P') : 'I')
const editId = ref(typeof route.query.id === 'string' ? route.query.id : '')
const esEdicion = computed(() => Boolean(editId.value))

interface Serie { id: string; serie: string; tipoComprobante: string; lugarExpedicion: string; nextFolio: number; estado: string }
const series = ref<Serie[]>([])
const seriesDelTipo = computed(() => series.value.filter((s) => s.tipoComprobante === tipo.value && s.estado === 'activa'))

const saving = ref(false)
const formError = ref('')

// --- Receptor (I/E) ---------------------------------------------------------
const serieId = ref('')
const receptor = reactive({ rfc: '', nombre: '', codigoPostal: '', regimenFiscal: '', correo: '' })
const customerEntityId = ref<string | null>(null)
const customerRecordId = ref<string | null>(null)
const usoCfdi = ref('G03')
const formaPago = ref<string | null>(null)
const metodoPago = ref('PUE')
const moneda = ref('MXN')
const tipoCambio = ref<number | null>(null)
const exportacion = ref('01')
const descuentoDocumento = ref(0)
const observaciones = ref('')

const clienteBusqueda = ref('')
const clienteOpciones = ref<Array<{ id: string; customData: Record<string, any> }>>([])
const clienteAbierto = ref(false)
let clienteDebounce: ReturnType<typeof setTimeout> | null = null

function buscarClientes() {
  if (clienteDebounce) clearTimeout(clienteDebounce)
  clienteDebounce = setTimeout(async () => {
    if (!clienteBusqueda.value.trim()) { clienteOpciones.value = []; return }
    try {
      const res = await $fetch<{ data: Array<{ id: string; customData: Record<string, any> }> }>('/api/records/clientes', {
        params: { search: clienteBusqueda.value.trim(), pageSize: 8 }
      })
      clienteOpciones.value = res.data
    } catch {
      clienteOpciones.value = []
    }
  }, 250)
}

function elegirCliente(row: { id: string; customData: Record<string, any> }) {
  const cd = row.customData ?? {}
  customerRecordId.value = row.id
  receptor.nombre = String(cd.nombre ?? '')
  receptor.correo = String(cd.email ?? '')
  // Convención de suite (decisión #2 de la HU): la Business Suite ya extiende
  // clientes con rfc/regimen_fiscal/codigo_postal_fiscal/uso_cfdi (extensions
  // en seedBusinessSuite.mjs); si el tenant los tiene, autocompletan. Si no,
  // se capturan a mano — el snapshot del documento es la verdad fiscal.
  if (cd.rfc) receptor.rfc = String(cd.rfc)
  const cp = cd.codigo_postal ?? cd.codigo_postal_fiscal
  if (cp) receptor.codigoPostal = String(cp)
  if (cd.regimen_fiscal) receptor.regimenFiscal = String(cd.regimen_fiscal)
  if (cd.uso_cfdi && USOS_CFDI.some((u) => u.value === String(cd.uso_cfdi))) usoCfdi.value = String(cd.uso_cfdi)
  clienteAbierto.value = false
  clienteBusqueda.value = receptor.nombre
}

// --- Conceptos (I/E) ---------------------------------------------------------
interface ConceptoDraft {
  descripcion: string
  claveProdServ: string
  claveUnidad: string
  cantidad: number
  valorUnitario: number
  descuento: number
  traslado: { clave: '002' | '003'; tipoFactor: 'Tasa' | 'Cuota' | 'Exento'; tasa: number } | null
  retencion: { clave: '002' | '003'; tipoFactor: 'Tasa' | 'Cuota' | 'Exento'; tasa: number } | null
}

function conceptoVacio(): ConceptoDraft {
  return { descripcion: '', claveProdServ: '', claveUnidad: 'H87', cantidad: 1, valorUnitario: 0, descuento: 0, traslado: IMPUESTOS_PRESET[0] ? { clave: IMPUESTOS_PRESET[0].clave, tipoFactor: IMPUESTOS_PRESET[0].tipoFactor, tasa: IMPUESTOS_PRESET[0].tasa } : null, retencion: null }
}
const conceptos = ref<ConceptoDraft[]>([conceptoVacio()])

function presetById(id: string) { return IMPUESTOS_PRESET.find((p) => p.id === id) ?? null }
function trasladoPresetId(c: ConceptoDraft): string {
  if (!c.traslado) return 'sin-impuesto'
  const match = IMPUESTOS_PRESET.find((p) => p.clave === c.traslado!.clave && p.tipoFactor === c.traslado!.tipoFactor && p.tasa === c.traslado!.tasa)
  return match?.id ?? 'iva16'
}
function setTrasladoPreset(c: ConceptoDraft, presetId: string) {
  const preset = presetById(presetId)
  c.traslado = preset && preset.id !== 'sin-impuesto' ? { clave: preset.clave, tipoFactor: preset.tipoFactor, tasa: preset.tasa } : null
}

// Búsqueda de productos por concepto
const productoBusqueda = reactive<Record<number, string>>({})
const productoOpciones = reactive<Record<number, Array<{ id: string; customData: Record<string, any> }>>>({})
const productoAbierto = reactive<Record<number, boolean>>({})
let productoDebounce: ReturnType<typeof setTimeout> | null = null

function buscarProducto(index: number) {
  if (productoDebounce) clearTimeout(productoDebounce)
  productoDebounce = setTimeout(async () => {
    const q = (productoBusqueda[index] ?? '').trim()
    if (!q) { productoOpciones[index] = []; return }
    try {
      const res = await $fetch<{ data: Array<{ id: string; customData: Record<string, any> }> }>('/api/records/productos', { params: { search: q, pageSize: 6 } })
      productoOpciones[index] = res.data
      productoAbierto[index] = true
    } catch {
      productoOpciones[index] = []
    }
  }, 250)
}

function elegirProducto(index: number, row: { id: string; customData: Record<string, any> }) {
  const cd = row.customData ?? {}
  const c = conceptos.value[index]
  if (!c) return
  c.descripcion = String(cd.nombre ?? '')
  if (cd.clave_prod_serv) c.claveProdServ = String(cd.clave_prod_serv)
  productoAbierto[index] = false
  productoBusqueda[index] = c.descripcion
}

function agregarConcepto() { conceptos.value.push(conceptoVacio()) }
function quitarConcepto(index: number) { if (conceptos.value.length > 1) conceptos.value.splice(index, 1) }

// --- Vista previa de totales (misma aritmética que el servidor) --------------
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
const round6 = (n: number) => Math.round((n + Number.EPSILON) * 1e6) / 1e6
const totales = computed(() => {
  let subtotal = 0
  let trasladado = 0
  let retenido = 0
  for (const c of conceptos.value) {
    const importe = round6((Number(c.cantidad) || 0) * (Number(c.valorUnitario) || 0))
    const base = Math.max(0, round6(importe - (Number(c.descuento) || 0)))
    subtotal += importe
    if (c.traslado && c.traslado.tipoFactor !== 'Exento') trasladado += round2(base * c.traslado.tasa)
    if (c.retencion && c.retencion.tipoFactor !== 'Exento') retenido += round2(base * c.retencion.tasa)
  }
  subtotal = round2(subtotal)
  const descDoc = round2(Number(descuentoDocumento.value) || 0)
  return { subtotal, trasladado: round2(trasladado), retenido: round2(retenido), total: round2(subtotal - descDoc + round2(trasladado) - round2(retenido)) }
})
const receptorCompleto = computed(() => Boolean(receptor.nombre.trim() && receptor.rfc.trim() && receptor.codigoPostal.trim() && receptor.regimenFiscal.trim()))
const conceptosCompletos = computed(() => conceptos.value.length > 0 && conceptos.value.every(c => Boolean(c.descripcion.trim() && c.claveProdServ.trim() && Number(c.cantidad) > 0 && Number(c.valorUnitario) >= 0)))
const listaParaTimbrar = computed(() => Boolean(serieId.value && receptorCompleto.value && conceptosCompletos.value))

// --- Relacionado (tipo E / sustituciones) ------------------------------------
const relacionadoDocumentId = ref<string | null>(typeof route.query.relacionado === 'string' ? route.query.relacionado : null)
const relacionadoTipo = ref('01')
interface Relacionable { id: string; folio: number | null; serie: string; uuidFiscal: string | null; receptorNombre: string | null; total: string; moneda: string }
const relacionables = ref<Relacionable[]>([])

// --- Origen dinámico (opcional, solo al crear) --------------------------------
// Vínculo source_record_id: la cuenta por cobrar que da lugar a la factura.
// Es lo que permite que el complemento de pagos (fase E) encuentre la factura
// timbrada de cada aplicación de cobro. Se puede pre-llenar con
// /facturacion/nuevo?tipo=I&sourceRecord=<uuid>.
const sourceRecordId = ref<string | null>(typeof route.query.sourceRecord === 'string' ? route.query.sourceRecord : null)
const sourceLabel = ref('')
const sourceBusqueda = ref('')
const sourceOpciones = ref<Array<{ id: string; customData: Record<string, any> }>>([])
const sourceAbierto = ref(false)
let sourceDebounce: ReturnType<typeof setTimeout> | null = null

function sourceRowLabel(row: { customData: Record<string, any> }) {
  const cd = row.customData ?? {}
  return [cd.folio, cd.numero_documento, cd.total != null ? formatoDinero(Number(cd.total), String(cd.moneda ?? 'MXN')) : null].filter(Boolean).join(' · ') || 'Cuenta por cobrar'
}

function buscarSource() {
  if (sourceDebounce) clearTimeout(sourceDebounce)
  sourceDebounce = setTimeout(async () => {
    if (!sourceBusqueda.value.trim()) { sourceOpciones.value = []; return }
    try {
      const res = await $fetch<{ data: Array<{ id: string; customData: Record<string, any> }> }>('/api/records/cuentas_por_cobrar', { params: { search: sourceBusqueda.value.trim(), pageSize: 8 } })
      sourceOpciones.value = res.data
      sourceAbierto.value = true
    } catch {
      sourceOpciones.value = []
    }
  }, 250)
}

function elegirSource(row: { id: string; customData: Record<string, any> }) {
  sourceRecordId.value = row.id
  sourceLabel.value = sourceRowLabel(row)
  sourceAbierto.value = false
}

function quitarSource() {
  sourceRecordId.value = null
  sourceLabel.value = ''
  sourceBusqueda.value = ''
}

async function resolverSourceInicial() {
  if (!sourceRecordId.value || sourceLabel.value) return
  try {
    const res = await $fetch<{ data: Array<{ id: string; customData: Record<string, any> }> }>('/api/records/cuentas_por_cobrar', { params: { pageSize: 100 } })
    const row = res.data.find((r) => r.id === sourceRecordId.value)
    if (row) sourceLabel.value = sourceRowLabel(row)
    else sourceLabel.value = 'Cuenta por cobrar vinculada'
  } catch {
    sourceLabel.value = 'Cuenta por cobrar vinculada'
  }
}

// --- Complemento de pagos (tipo P) -------------------------------------------
const cobroBusqueda = ref('')
const cobroOpciones = ref<Array<{ id: string; customData: Record<string, any> }>>([])
const cobroElegido = ref<{ id: string; customData: Record<string, any> } | null>(null)
const formaPagoComplemento = ref('')
let cobroDebounce: ReturnType<typeof setTimeout> | null = null

function buscarCobros() {
  if (cobroDebounce) clearTimeout(cobroDebounce)
  cobroDebounce = setTimeout(async () => {
    try {
      const params: Record<string, string | number> = { filterField: 'estado', filterValues: 'aplicado', pageSize: 20 }
      if (cobroBusqueda.value.trim()) params.search = cobroBusqueda.value.trim()
      const res = await $fetch<{ data: Array<{ id: string; customData: Record<string, any> }> }>('/api/records/cobros_cliente', { params })
      cobroOpciones.value = res.data
    } catch {
      cobroOpciones.value = []
    }
  }, 250)
}

function cobroLabel(row: { customData: Record<string, any> }) {
  const cd = row.customData ?? {}
  const partes = [cd.folio, cd.fecha, cd.monto != null ? formatoDinero(Number(cd.monto), String(cd.moneda ?? 'MXN')) : null, cd.referencia].filter(Boolean)
  return partes.join(' · ') || 'Cobro'
}

// Pre-selección desde el puente del detalle dinámico
// (RecordDetailView → /facturacion/nuevo?tipo=P&cobro={id}).
async function preseleccionarCobro(cobroId: string) {
  try {
    const row = await $fetch<{ id: string; customData: Record<string, any> }>(`/api/records/cobros_cliente/${cobroId}`)
    if (row?.id) cobroElegido.value = { id: row.id, customData: row.customData ?? {} }
  } catch {
    // no legible o inexistente: queda el buscador manual
  }
}

// --- Carga inicial ------------------------------------------------------------
const cargando = ref(true)

async function init() {
  cargando.value = true
  try {
    const [seriesRes] = await Promise.all([
      $fetch<Serie[]>('/api/facturacion/series').catch(() => [] as Serie[]),
      tipo.value === 'E' ? $fetch<Relacionable[]>('/api/facturacion/relacionables').then((r) => (relacionables.value = r)).catch(() => {}) : Promise.resolve(),
      resolverSourceInicial()
    ])
    series.value = seriesRes
    if (esEdicion.value) {
      await hydrateEdicion()
    } else if (serieId.value === '' && seriesDelTipo.value.length === 1) {
      serieId.value = seriesDelTipo.value[0].id
    }
    if (!esEdicion.value && tipo.value === 'P' && typeof route.query.cobro === 'string' && route.query.cobro) {
      await preseleccionarCobro(route.query.cobro)
    }
  } finally {
    cargando.value = false
  }
}

async function hydrateEdicion() {
  const detail = await $fetch<any>(`/api/facturacion/documents/${editId.value}`)
  const doc = detail.documento
  tipo.value = doc.tipo
  serieId.value = doc.serieId
  receptor.rfc = doc.receptorRfc ?? ''
  receptor.nombre = doc.receptorNombre ?? ''
  receptor.codigoPostal = doc.receptorCodigoPostal ?? ''
  receptor.regimenFiscal = doc.receptorRegimenFiscal ?? ''
  receptor.correo = doc.receptorCorreo ?? ''
  customerEntityId.value = doc.customerEntityId
  customerRecordId.value = doc.customerRecordId
  clienteBusqueda.value = doc.receptorNombre ?? ''
  usoCfdi.value = doc.usoCfdi ?? 'G03'
  formaPago.value = doc.formaPago
  metodoPago.value = doc.metodoPago ?? 'PUE'
  moneda.value = doc.moneda ?? 'MXN'
  tipoCambio.value = doc.tipoCambio != null ? Number(doc.tipoCambio) : null
  exportacion.value = doc.exportacion ?? '01'
  descuentoDocumento.value = Number(doc.descuento ?? 0)
  observaciones.value = doc.observaciones ?? ''
  if (doc.cfdiRelacionadoId) { relacionadoDocumentId.value = doc.cfdiRelacionadoId; relacionadoTipo.value = doc.tipoRelacion ?? '01' }
  conceptos.value = (detail.conceptos ?? []).map((c: any) => ({
    descripcion: c.descripcion,
    claveProdServ: c.claveProdServ,
    claveUnidad: c.claveUnidad,
    cantidad: Number(c.cantidad),
    valorUnitario: Number(c.valorUnitario),
    descuento: Number(c.descuento),
    traslado: c.impuestos?.traslados?.[0] ? { clave: c.impuestos.traslados[0].impuesto, tipoFactor: c.impuestos.traslados[0].tipoFactor, tasa: Number(c.impuestos.traslados[0].tasaOCuota) } : null,
    retencion: c.impuestos?.retenciones?.[0] ? { clave: c.impuestos.retenciones[0].impuesto, tipoFactor: c.impuestos.retenciones[0].tipoFactor, tasa: Number(c.impuestos.retenciones[0].tasaOCuota) } : null
  }))
  if (!conceptos.value.length) conceptos.value = [conceptoVacio()]
}

onMounted(init)
watch(tipo, () => { if (!esEdicion.value) serieId.value = seriesDelTipo.value.length === 1 ? seriesDelTipo.value[0].id : '' })

async function submit(shouldTimbrar = false) {
  saving.value = true
  formError.value = ''
  try {
    if (tipo.value === 'P') {
      if (!cobroElegido.value) { formError.value = 'Elige el cobro aplicado que vas a documentar.'; return }
      if (!formaPagoComplemento.value) { formError.value = 'Indica la forma de pago del complemento (catálogo SAT).'; return }
      const res = await $fetch<{ id: string }>('/api/facturacion/complementos', {
        method: 'POST',
        body: { cobroRecordId: cobroElegido.value.id, formaPago: formaPagoComplemento.value, serieId: serieId.value || undefined }
      })
      toast.success('Complemento creado', 'Revísalo y tímbrelo desde el detalle.')
      await router.push(`/facturacion/${res.id}`)
      return
    }
    if (!serieId.value) { formError.value = 'Elige la serie fiscal (créala desde el listado si no existe).'; return }
    if (!receptor.nombre.trim()) { formError.value = 'El receptor necesita nombre.'; return }
    const body: Record<string, unknown> = {
      receptor: {
        rfc: receptor.rfc.trim(),
        nombre: receptor.nombre.trim(),
        codigoPostal: receptor.codigoPostal.trim(),
        regimenFiscal: receptor.regimenFiscal.trim(),
        correo: receptor.correo.trim() || null
      },
      customerEntityId: customerEntityId.value,
      customerRecordId: customerRecordId.value,
      sourceRecordId: sourceRecordId.value,
      usoCfdi: usoCfdi.value,
      formaPago: formaPago.value,
      metodoPago: metodoPago.value,
      moneda: moneda.value,
      tipoCambio: moneda.value === 'MXN' ? null : tipoCambio.value,
      exportacion: exportacion.value,
      descuentoDocumento: Number(descuentoDocumento.value) || 0,
      observaciones: observaciones.value.trim() || null,
      conceptos: conceptos.value.map((c) => ({
        descripcion: c.descripcion.trim(),
        claveProdServ: c.claveProdServ.trim(),
        claveUnidad: c.claveUnidad.trim() || 'H87',
        cantidad: Number(c.cantidad),
        valorUnitario: Number(c.valorUnitario),
        descuento: Number(c.descuento) || 0,
        traslado: c.traslado,
        retencion: c.retencion
      })),
      relacionado: tipo.value === 'E' || relacionadoDocumentId.value ? { documentId: relacionadoDocumentId.value, tipoRelacion: relacionadoTipo.value } : null
    }
    if (esEdicion.value) {
      await $fetch(`/api/facturacion/documents/${editId.value}`, { method: 'PUT', body })
      if (shouldTimbrar) {
        await $fetch(`/api/facturacion/documents/${editId.value}/timbrar`, { method: 'POST' })
        toast.success('Factura timbrada', 'El comprobante ya tiene respuesta fiscal.')
      } else toast.updated('Documento actualizado', 'Los cambios del borrador se guardaron.')
      await router.push(`/facturacion/${editId.value}`)
    } else {
      const res = await $fetch<{ id: string }>('/api/facturacion/documents', { method: 'POST', body: { ...body, serieId: serieId.value, tipo: tipo.value } })
      if (shouldTimbrar) {
        await $fetch(`/api/facturacion/documents/${res.id}/timbrar`, { method: 'POST' })
        toast.success('Factura timbrada', 'El comprobante ya tiene respuesta fiscal.')
      } else toast.success('Borrador creado', 'Revisa el documento y tímbrelo cuando esté listo.')
      await router.push(`/facturacion/${res.id}`)
    }
  } catch (err: any) {
    formError.value = err?.data?.statusMessage || 'No se pudo guardar el documento'
    toast.error('No se pudo guardar', formError.value)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="invoice-page">
    <div class="invoice-topbar">
      <div>
        <div class="invoice-breadcrumb"><NuxtLink to="/facturacion">Inicio</NuxtLink><span>/</span><NuxtLink to="/facturacion">Facturación</NuxtLink><span>/</span><strong>Nueva factura</strong></div>
        <div class="invoice-title-row"><h1>{{ esEdicion ? 'Editar documento' : tipo === 'I' ? 'Nueva factura' : tipo === 'E' ? 'Nueva nota de crédito' : 'Nuevo complemento de pago' }}</h1><span class="invoice-status">Borrador</span></div>
        <p>Captura los datos fiscales y conceptos del comprobante</p>
      </div>
      <div class="invoice-actions"><NuxtLink to="/facturacion" class="invoice-btn invoice-btn-ghost">Cancelar</NuxtLink><button type="button" class="invoice-btn invoice-btn-outline" :disabled="saving" @click="submit(false)">Guardar borrador</button><button type="button" class="invoice-btn invoice-btn-primary" :disabled="saving || !listaParaTimbrar" :title="!listaParaTimbrar ? 'Completa el receptor y agrega al menos un concepto para timbrar' : ''" @click="submit(true)">{{ saving ? 'Timbrando…' : 'Timbrar factura' }}</button></div>
    </div>
    <div v-if="cargando" class="invoice-loading">Cargando…</div>
    <section v-else-if="tipo === 'P' && !esEdicion" class="invoice-single-column">
      <article class="invoice-card"><header class="invoice-card-header"><div class="invoice-card-icon">↔</div><div><h2>Cobro aplicado</h2><p>Selecciona el cobro que vas a documentar con un complemento de pagos.</p></div></header><div class="invoice-card-body">
        <div class="invoice-field full"><label>Buscar cobro aplicado</label><div class="invoice-search"><Search /><input v-model="cobroBusqueda" placeholder="Buscar por folio, referencia o monto…" @input="buscarCobros" /></div><ul v-if="cobroOpciones.length && !cobroElegido" class="invoice-results"><li v-for="row in cobroOpciones" :key="row.id"><button type="button" @click="cobroElegido = row">{{ cobroLabel(row) }}</button></li></ul></div>
        <div v-if="cobroElegido" class="invoice-selected"><span>{{ cobroLabel(cobroElegido) }}</span><button type="button" @click="cobroElegido = null">Quitar</button></div>
        <div class="invoice-grid-2"><label class="invoice-field"><span>Forma de pago (SAT) *</span><select v-model="formaPagoComplemento"><option value="" disabled>Selecciona…</option><option v-for="f in FORMAS_PAGO" :key="f.value" :value="f.value">{{ f.label }}</option></select></label><label class="invoice-field"><span>Serie tipo P</span><select v-model="serieId"><option value="">Primera activa</option><option v-for="s in seriesDelTipo" :key="s.id" :value="s.id">{{ s.serie }} · CP {{ s.lugarExpedicion }}</option></select></label></div>
      </div></article>
    </section>
    <div v-else class="invoice-columns">
      <main class="invoice-main">
        <article class="invoice-card"><header class="invoice-card-header"><div class="invoice-card-icon">▣</div><div><h2>Datos del comprobante</h2><p>Define el tipo y los datos fiscales de emisión.</p></div></header><div class="invoice-card-body">
          <div class="invoice-type-row"><button type="button" :class="{ active: tipo === 'I' }" @click="tipo = 'I'">Ingreso</button><button type="button" :class="{ active: tipo === 'E' }" @click="tipo = 'E'">Egreso</button><button type="button" :class="{ active: tipo === 'P' }" @click="tipo = 'P'">Pago</button></div>
          <div class="invoice-grid-2"><label class="invoice-field"><span>Serie fiscal *</span><select v-model="serieId" :disabled="esEdicion"><option value="" disabled>{{ seriesDelTipo.length ? 'Selecciona…' : 'No hay series activas' }}</option><option v-for="s in seriesDelTipo" :key="s.id" :value="s.id">{{ s.serie }} · CP {{ s.lugarExpedicion }} · folio {{ s.nextFolio }}</option></select></label><label class="invoice-field"><span>Fecha de emisión</span><input type="date" :value="new Date().toISOString().slice(0,10)" disabled /></label><label class="invoice-field"><span>Moneda</span><select v-model="moneda"><option value="MXN">MXN · Peso mexicano</option><option value="USD">USD · Dólar estadounidense</option><option value="EUR">EUR · Euro</option></select></label><label v-if="moneda !== 'MXN'" class="invoice-field"><span>Tipo de cambio</span><input v-model.number="tipoCambio" type="number" min="0" step="any" /></label><label class="invoice-field"><span>Exportación</span><select v-model="exportacion"><option v-for="e in EXPORTACION" :key="e.value" :value="e.value">{{ e.label }}</option></select></label></div>
        </div></article>
        <article class="invoice-card"><header class="invoice-card-header"><div class="invoice-card-icon">♙</div><div><h2>Receptor</h2><p>Busca un cliente y confirma sus datos fiscales.</p></div></header><div class="invoice-card-body">
          <div class="invoice-field full"><label>Cliente</label><div class="invoice-search"><Search /><input v-model="clienteBusqueda" placeholder="Buscar cliente por nombre, RFC o correo" @input="clienteAbierto = true; buscarClientes()" /></div><ul v-if="clienteAbierto && clienteOpciones.length" class="invoice-results"><li v-for="row in clienteOpciones" :key="row.id"><button type="button" @click="elegirCliente(row)"><strong>{{ row.customData?.nombre }}</strong><small v-if="row.customData?.rfc">{{ row.customData.rfc }}</small></button></li></ul></div>
          <div v-if="customerRecordId" class="invoice-selected"><span><strong>{{ receptor.nombre }}</strong><small>{{ receptor.rfc || 'RFC pendiente' }} · {{ receptor.regimenFiscal || 'Régimen pendiente' }}</small></span><button type="button" @click="customerRecordId = null">Cambiar cliente</button></div>
          <div class="invoice-grid-2"><label class="invoice-field"><span>Nombre o razón social *</span><input v-model="receptor.nombre" maxlength="250" /></label><label class="invoice-field"><span>RFC *</span><input v-model="receptor.rfc" maxlength="13" placeholder="AAA010101AAA" /></label><label class="invoice-field"><span>Código postal *</span><input v-model="receptor.codigoPostal" maxlength="5" inputmode="numeric" /></label><label class="invoice-field"><span>Régimen fiscal *</span><select v-model="receptor.regimenFiscal"><option value="">Selecciona…</option><option v-for="r in REGIMENES_FISCALES" :key="r.value" :value="r.value">{{ r.label }}</option></select></label><label class="invoice-field full"><span>Correo para enviar el CFDI</span><input v-model="receptor.correo" type="email" placeholder="receptor@empresa.com" /></label></div>
          <div v-if="!receptorCompleto" class="invoice-alert">El cliente necesita completar sus datos fiscales antes de timbrar.</div>
        </div></article>
        <article v-if="tipo === 'E'" class="invoice-card"><header class="invoice-card-header"><div class="invoice-card-icon">↗</div><div><h2>Factura relacionada</h2><p>Una nota de crédito debe relacionarse con un CFDI timbrado.</p></div></header><div class="invoice-card-body invoice-grid-2"><label class="invoice-field"><span>CFDI relacionado *</span><select v-model="relacionadoDocumentId"><option :value="null" disabled>Selecciona…</option><option v-for="r in relacionables" :key="r.id" :value="r.id">{{ r.serie }}-{{ String(r.folio ?? 0).padStart(6, '0') }} · {{ r.receptorNombre }} · {{ formatoDinero(r.total, r.moneda) }}</option></select></label><label class="invoice-field"><span>Tipo de relación *</span><select v-model="relacionadoTipo"><option v-for="t in TIPOS_RELACION" :key="t.value" :value="t.value">{{ t.label }}</option></select></label></div></article>
        <article class="invoice-card"><header class="invoice-card-header"><div class="invoice-card-icon">▤</div><div><h2>Conceptos</h2><p>Agrega los productos o servicios de la factura.</p></div><span class="invoice-count">{{ conceptos.length }}</span></header><div class="invoice-card-body">
          <div v-for="(c, i) in conceptos" :key="i" class="concept-row"><div class="concept-row-head"><span>Concepto {{ i + 1 }}</span><button type="button" :disabled="conceptos.length <= 1" @click="quitarConcepto(i)"><Trash2 /></button></div><div class="invoice-field full relative"><label>Producto o servicio</label><div class="invoice-search"><Search /><input v-model="productoBusqueda[i]" placeholder="Buscar en tu catálogo (opcional)" @input="buscarProducto(i)" /></div><ul v-if="productoAbierto[i] && productoOpciones[i]?.length" class="invoice-results"><li v-for="row in productoOpciones[i]" :key="row.id"><button type="button" @click="elegirProducto(i, row)">{{ row.customData?.nombre }} <small v-if="row.customData?.sku">· {{ row.customData.sku }}</small></button></li></ul></div><div class="invoice-field full"><span>Descripción *</span><input v-model="c.descripcion" maxlength="1000" placeholder="Describe el producto o servicio" /></div><div class="invoice-grid-4"><label class="invoice-field"><span>Clave SAT *</span><input v-model="c.claveProdServ" maxlength="8" inputmode="numeric" placeholder="01010101" /></label><label class="invoice-field"><span>Unidad</span><input v-model="c.claveUnidad" maxlength="6" placeholder="H87" /></label><label class="invoice-field"><span>Cantidad *</span><input v-model.number="c.cantidad" type="number" min="0.000001" step="any" /></label><label class="invoice-field"><span>Valor unitario *</span><input v-model.number="c.valorUnitario" type="number" min="0" step="any" /></label></div><div class="invoice-grid-2"><label class="invoice-field"><span>Descuento</span><input v-model.number="c.descuento" type="number" min="0" step="any" /></label><label class="invoice-field"><span>Impuesto trasladado</span><select :value="trasladoPresetId(c)" @change="setTrasladoPreset(c, String(($event.target as HTMLSelectElement).value))"><option v-for="p in IMPUESTOS_PRESET" :key="p.id" :value="p.id">{{ p.label }}</option></select></label></div><div class="concept-amount">Importe <strong>{{ formatoDinero(round6(c.cantidad * c.valorUnitario), moneda) }}</strong></div></div>
          <button type="button" class="invoice-add" @click="agregarConcepto"><Plus /> Agregar concepto</button>
        </div></article>
        <article class="invoice-card"><header class="invoice-card-header"><div class="invoice-card-icon">◫</div><div><h2>Datos de pago</h2><p>Información complementaria del CFDI.</p></div></header><div class="invoice-card-body invoice-grid-2"><label class="invoice-field"><span>Uso de CFDI *</span><select v-model="usoCfdi"><option v-for="u in USOS_CFDI" :key="u.value" :value="u.value">{{ u.label }}</option></select></label><label class="invoice-field"><span>Método de pago</span><select v-model="metodoPago"><option v-for="m in METODOS_PAGO" :key="m.value" :value="m.value">{{ m.label }}</option></select></label><label class="invoice-field"><span>Forma de pago</span><select v-model="formaPago"><option :value="null">— Selecciona —</option><option v-for="f in FORMAS_PAGO" :key="f.value" :value="f.value">{{ f.label }}</option></select></label><label class="invoice-field"><span>Descuento global</span><input v-model.number="descuentoDocumento" type="number" min="0" step="any" /></label><label class="invoice-field full"><span>Observaciones</span><textarea v-model="observaciones" rows="2" maxlength="500" placeholder="Notas internas o instrucciones para el receptor"></textarea></label></div></article>
        <div v-if="formError" class="invoice-error">{{ formError }}</div>
      </main>
      <aside class="invoice-aside"><article class="invoice-card invoice-sticky"><header class="invoice-card-header"><div class="invoice-card-icon">◈</div><div><h2>Resumen fiscal</h2><p>Se recalcula al guardar.</p></div></header><div class="invoice-card-body"><dl class="invoice-summary"><div><dt>Subtotal</dt><dd>{{ formatoDinero(totales.subtotal, moneda) }}</dd></div><div><dt>Descuento</dt><dd>−{{ formatoDinero(descuentoDocumento, moneda) }}</dd></div><div><dt>IVA trasladado</dt><dd>{{ formatoDinero(totales.trasladado, moneda) }}</dd></div><div><dt>Retenciones</dt><dd>−{{ formatoDinero(totales.retenido, moneda) }}</dd></div><div class="total"><dt>Total</dt><dd>{{ formatoDinero(totales.total, moneda) }}</dd></div></dl><div class="summary-meta"><span>Moneda <b>{{ moneda }}</b></span><span>Conceptos <b>{{ conceptos.length }}</b></span><span>Estado <b :class="listaParaTimbrar ? 'good' : 'warn'">{{ listaParaTimbrar ? 'Lista para timbrar' : 'Datos incompletos' }}</b></span></div></div></article><article class="invoice-card"><header class="invoice-card-header"><div class="invoice-card-icon">✓</div><div><h2>Validación fiscal</h2><p>Requisitos antes del timbrado.</p></div></header><div class="invoice-card-body validation-list"><div><span :class="serieId ? 'ok' : 'warning'">●</span> Serie configurada</div><div><span :class="receptorCompleto ? 'ok' : 'warning'">●</span> Receptor completo</div><div><span :class="receptor.rfc ? 'ok' : 'warning'">●</span> RFC válido</div><div><span :class="receptor.regimenFiscal ? 'ok' : 'warning'">●</span> Régimen fiscal válido</div><div><span :class="receptor.codigoPostal ? 'ok' : 'warning'">●</span> Código postal válido</div><div><span :class="conceptosCompletos ? 'ok' : 'warning'">●</span> Conceptos completos</div><div><span :class="conceptos.length ? 'ok' : 'warning'">●</span> Impuestos calculados</div></div></article><div class="invoice-bottom-actions"><button type="button" class="invoice-btn invoice-btn-primary w-full" :disabled="saving" @click="submit(false)">{{ saving ? 'Guardando…' : 'Guardar borrador' }}</button><NuxtLink to="/facturacion" class="invoice-btn invoice-btn-ghost w-full">Cancelar</NuxtLink></div></aside>
    </div>
  </div>
</template>

<style scoped>
.invoice-page { max-width: 1440px; margin: 0 auto; padding: 8px 32px 72px; color: #33475B; }
.invoice-topbar { display:flex; justify-content:space-between; gap:28px; align-items:flex-end; margin-bottom:24px; }
.invoice-breadcrumb { display:flex; gap:8px; align-items:center; font-size:12px; color:#8DA1B5; margin-bottom:12px; }
.invoice-breadcrumb a:hover { color:#0091AE; }
.invoice-breadcrumb strong { color:#33475B; }
.invoice-title-row { display:flex; align-items:center; gap:12px; }
.invoice-title-row h1 { margin:0; font-size:26px; line-height:1.2; color:#33475B; }
.invoice-topbar p { margin:6px 0 0; color:#607D98; font-size:14px; }
.invoice-status { border-radius:999px; background:#EAF7F0; color:#16825D; padding:5px 10px; font-size:11px; font-weight:700; }
.invoice-actions { display:flex; align-items:center; gap:10px; }
.invoice-btn { display:inline-flex; align-items:center; justify-content:center; gap:7px; min-height:38px; border-radius:6px; padding:0 14px; font-size:13px; font-weight:700; border:1px solid #CBD6E2; transition:.15s; }
.invoice-btn:disabled { opacity:.5; cursor:not-allowed; }
.invoice-btn-ghost { color:#607D98; background:white; }
.invoice-btn-outline { color:#33475B; background:white; }
.invoice-btn-primary { color:#fff; border-color:#FF7A59; background:#FF7A59; }
.invoice-btn-primary:hover:not(:disabled) { background:#E66B4D; }
.invoice-columns { display:grid; grid-template-columns:minmax(0,1fr) 340px; gap:20px; align-items:start; }
.invoice-main { display:flex; flex-direction:column; gap:20px; min-width:0; }
.invoice-aside { display:flex; flex-direction:column; gap:20px; }
.invoice-sticky { position:sticky; top:20px; }
.invoice-single-column { max-width:900px; }
.invoice-card { overflow:visible; border:1px solid #DFE5EB; border-radius:10px; background:#fff; box-shadow:0 1px 3px rgba(51,71,91,.08); }
.invoice-card-header { display:flex; align-items:center; gap:10px; border-bottom:1px solid #E5EAF0; padding:16px 20px; }
.invoice-card-header h2 { margin:0; color:#33475B; font-size:16px; font-weight:700; }
.invoice-card-header p { margin:3px 0 0; color:#607D98; font-size:12px; }
.invoice-card-icon { display:flex; width:30px; height:30px; align-items:center; justify-content:center; border-radius:7px; background:#EAF7F9; color:#0091AE; font-size:16px; font-weight:700; }
.invoice-card-body { display:flex; flex-direction:column; gap:20px; padding:24px; }
.invoice-grid-2 { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:18px 20px; }
.invoice-grid-4 { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:12px; }
.invoice-field { display:flex; flex-direction:column; gap:6px; position:relative; color:#33475B; font-size:13px; font-weight:600; }
.invoice-field.full { grid-column:1/-1; }
.invoice-field input,.invoice-field select,.invoice-field textarea { width:100%; border:1px solid #CBD6E2; border-radius:6px; min-height:38px; background:#fff; color:#33475B; padding:8px 10px; font-size:13px; font-weight:400; outline:none; }
.invoice-field textarea { resize:vertical; }
.invoice-field input:focus,.invoice-field select:focus,.invoice-field textarea:focus { border-color:#0091AE; box-shadow:0 0 0 2px #0091AE18; }
.invoice-search { display:flex; align-items:center; gap:8px; border:1px solid #CBD6E2; border-radius:6px; min-height:40px; padding:0 10px; background:#fff; }
.invoice-search svg { width:16px; color:#8DA1B5; }
.invoice-search input { min-height:34px; border:0; padding:0; box-shadow:none; }
.invoice-results { position:absolute; top:100%; left:0; right:0; z-index:20; max-height:230px; overflow:auto; margin-top:4px; padding:4px; border:1px solid #DFE5EB; border-radius:7px; background:#fff; box-shadow:0 8px 24px rgba(51,71,91,.16); }
.invoice-results button { display:flex; width:100%; flex-direction:column; gap:2px; padding:9px 10px; border-radius:5px; text-align:left; color:#33475B; font-size:13px; }
.invoice-results button:hover { background:#F5F8FA; }
.invoice-results small,.invoice-selected small { display:block; color:#8DA1B5; font-size:11px; font-weight:400; }
.invoice-selected { display:flex; align-items:center; justify-content:space-between; gap:16px; padding:12px 14px; border:1px solid #B7E7EF; border-radius:7px; background:#F0FBFC; color:#33475B; font-size:13px; }
.invoice-selected button { color:#0091AE; font-size:12px; font-weight:700; }
.invoice-type-row { display:grid; grid-template-columns:repeat(3,1fr); gap:12px; }
.invoice-type-row button { min-height:40px; border:1px solid #CBD6E2; border-radius:6px; background:#fff; color:#607D98; font-size:13px; font-weight:700; }
.invoice-type-row button.active { border-color:#0091AE; background:#EAF7F9; color:#0091AE; }
.concept-row { display:flex; flex-direction:column; gap:14px; padding:16px; border:1px solid #E5EAF0; border-radius:8px; background:#fff; }
.concept-row-head { display:flex; align-items:center; justify-content:space-between; color:#33475B; font-size:13px; font-weight:700; }
.concept-row-head button { display:flex; align-items:center; justify-content:center; width:28px; height:28px; border-radius:5px; color:#8DA1B5; }
.concept-row-head svg { width:15px; }
.concept-amount { display:flex; align-items:center; justify-content:space-between; border-top:1px solid #E5EAF0; padding-top:12px; color:#607D98; font-size:12px; }
.concept-amount strong { color:#33475B; font-size:14px; }
.invoice-add { display:inline-flex; align-items:center; justify-content:center; align-self:flex-start; gap:6px; min-height:36px; border:1px dashed #9FB3C8; border-radius:6px; padding:0 13px; color:#0091AE; font-size:13px; font-weight:700; }
.invoice-add:hover { background:#F0FBFC; }
.invoice-add svg { width:15px; }
.invoice-count { margin-left:auto; color:#8DA1B5; font-size:12px; }
.invoice-summary { display:flex; flex-direction:column; gap:11px; margin:0; font-size:13px; }
.invoice-summary div { display:flex; justify-content:space-between; gap:10px; }
.invoice-summary dt { color:#607D98; }
.invoice-summary dd { margin:0; color:#33475B; font-variant-numeric:tabular-nums; }
.invoice-summary .total { margin-top:8px; border-top:1px solid #E5EAF0; padding-top:14px; }
.invoice-summary .total dt,.invoice-summary .total dd { color:#33475B; font-size:20px; font-weight:700; }
.summary-meta { display:flex; flex-direction:column; gap:9px; margin-top:20px; padding-top:16px; border-top:1px solid #E5EAF0; color:#8DA1B5; font-size:12px; }
.summary-meta span { display:flex; justify-content:space-between; gap:10px; }
.summary-meta b { color:#607D98; }
.summary-meta b.good { color:#16825D; }
.summary-meta b.warn { color:#B7791F; }
.validation-list { gap:13px; color:#33475B; font-size:13px; }
.validation-list div { display:flex; align-items:center; gap:9px; }
.validation-list span { color:#B7791F; font-size:12px; }
.validation-list span.ok { color:#16825D; }
.invoice-alert { border-radius:6px; padding:10px 12px; background:#FFF4E5; color:#8A5D00; font-size:12px; }
.invoice-error { border-radius:7px; padding:12px 14px; background:#FDECEC; color:#C0392B; font-size:13px; }
.invoice-bottom-actions { display:flex; flex-direction:column; gap:8px; }
.invoice-loading { padding:48px; text-align:center; color:#8DA1B5; font-size:14px; }
@media (max-width: 900px) { .invoice-page { padding:8px 20px 72px; } .invoice-topbar { align-items:flex-start; flex-direction:column; } .invoice-actions { width:100%; } .invoice-actions .invoice-btn { flex:1; } .invoice-columns { grid-template-columns:1fr; } .invoice-sticky { position:static; } }
@media (max-width: 620px) { .invoice-page { padding:4px 14px 60px; } .invoice-grid-2,.invoice-grid-4 { grid-template-columns:1fr; } .invoice-field.full { grid-column:auto; } .invoice-type-row { grid-template-columns:1fr; } .invoice-actions { flex-wrap:wrap; } .invoice-actions .invoice-btn { flex:auto; } .invoice-card-body { padding:18px; } }
</style>


