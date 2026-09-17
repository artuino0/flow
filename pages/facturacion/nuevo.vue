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

async function submit() {
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
      toast.updated('Documento actualizado', 'Los cambios del borrador se guardaron.')
      await router.push(`/facturacion/${editId.value}`)
    } else {
      const res = await $fetch<{ id: string }>('/api/facturacion/documents', { method: 'POST', body: { ...body, serieId: serieId.value, tipo: tipo.value } })
      toast.success('Borrador creado', 'Revisa el documento y tímbrelo cuando esté listo.')
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
  <div class="mx-auto min-h-[calc(100vh-120px)] max-w-4xl pb-16">
    <NuxtLink to="/facturacion" class="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-text-secondary hover:text-brand-blue">
      <ArrowLeft class="h-4 w-4" :stroke-width="1.75" /> Volver a Facturación
    </NuxtLink>
    <header class="mt-3">
      <h1 class="text-[22px] font-bold text-brand-text">
        {{ esEdicion ? 'Editar documento' : tipo === 'I' ? 'Nueva factura' : tipo === 'E' ? 'Nueva nota de crédito' : 'Nuevo complemento de pago' }}
      </h1>
      <p class="mt-1 text-sm text-brand-text-secondary">
        {{ tipo === 'P' ? 'Documenta un cobro aplicado con sus facturas timbradas (complemento de pagos 2.0)' : 'Los totales e impuestos los calcula FlowERP; el timbrado valida contra el SAT' }}
      </p>
    </header>

    <div v-if="cargando" class="mt-6 text-sm text-brand-text-muted">Cargando…</div>

    <!-- Complemento de pagos -->
    <section v-else-if="tipo === 'P' && !esEdicion" class="mt-6 space-y-5">
      <div class="rounded-lg border border-brand-border-light bg-white p-5">
        <h2 class="text-[15px] font-bold text-brand-text">Cobro aplicado</h2>
        <p class="mt-1 text-[13px] text-brand-text-secondary">Del módulo Cobros de clientes (solo estado "aplicado"). Cada aplicación debe apuntar a una cuenta por cobrar con factura timbrada.</p>
        <div class="relative mt-4">
          <Search class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-brand-text-muted" :stroke-width="1.75" />
          <input v-model="cobroBusqueda" type="search" placeholder="Buscar cobro por folio o referencia…" class="w-full rounded border border-brand-border py-2 pl-9 pr-3 text-sm focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue" @input="buscarCobros" @focus="buscarCobros" />
          <ul v-if="cobroOpciones.length && !cobroElegido" class="absolute z-10 mt-1 max-h-60 w-full overflow-y-auto rounded border border-brand-border-light bg-white shadow-lg">
            <li v-for="row in cobroOpciones" :key="row.id">
              <button type="button" class="w-full px-3 py-2 text-left text-sm hover:bg-brand-bg" @click="cobroElegido = row">{{ cobroLabel(row) }}</button>
            </li>
          </ul>
        </div>
        <div v-if="cobroElegido" class="mt-3 flex items-center justify-between rounded border border-brand-border-light bg-brand-bg px-3 py-2 text-sm">
          <span class="font-semibold text-brand-text">{{ cobroLabel(cobroElegido) }}</span>
          <button type="button" class="text-xs font-semibold text-brand-text-secondary hover:text-brand-error-text" @click="cobroElegido = null">Quitar</button>
        </div>
      </div>
      <div class="rounded-lg border border-brand-border-light bg-white p-5">
        <h2 class="text-[15px] font-bold text-brand-text">Datos del complemento</h2>
        <div class="mt-4 grid gap-4 sm:grid-cols-2">
          <label class="flex flex-col gap-1.5 text-[13px] font-semibold text-brand-text">Forma de pago (SAT)
            <select v-model="formaPagoComplemento" class="rounded border border-brand-border bg-white px-3 py-2 text-sm font-normal focus:border-brand-blue focus:outline-none">
              <option value="" disabled>Selecciona…</option>
              <option v-for="f in FORMAS_PAGO" :key="f.value" :value="f.value">{{ f.label }}</option>
            </select>
          </label>
          <label class="flex flex-col gap-1.5 text-[13px] font-semibold text-brand-text">Serie tipo P (opcional)
            <select v-model="serieId" class="rounded border border-brand-border bg-white px-3 py-2 text-sm font-normal focus:border-brand-blue focus:outline-none">
              <option value="">Primera activa</option>
              <option v-for="s in seriesDelTipo" :key="s.id" :value="s.id">{{ s.serie }} · CP {{ s.lugarExpedicion }}</option>
            </select>
          </label>
        </div>
      </div>
    </section>

    <!-- Factura / nota de crédito -->
    <template v-else>
      <section class="mt-6 rounded-lg border border-brand-border-light bg-white p-5">
        <h2 class="text-[15px] font-bold text-brand-text">Serie y receptor</h2>
        <div class="mt-4 grid gap-4 sm:grid-cols-2">
          <label class="flex flex-col gap-1.5 text-[13px] font-semibold text-brand-text">Serie fiscal
            <select v-model="serieId" :disabled="esEdicion" class="rounded border border-brand-border bg-white px-3 py-2 text-sm font-normal focus:border-brand-blue focus:outline-none disabled:bg-brand-bg">
              <option value="" disabled>{{ seriesDelTipo.length ? 'Selecciona…' : 'No hay series activas de este tipo — créala en el listado' }}</option>
              <option v-for="s in seriesDelTipo" :key="s.id" :value="s.id">{{ s.serie }} · CP {{ s.lugarExpedicion }} · folio {{ s.nextFolio }}</option>
            </select>
          </label>
          <div class="relative flex flex-col gap-1.5 text-[13px] font-semibold text-brand-text">Cliente (módulo dinámico)
            <div class="relative">
              <Search class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-brand-text-muted" :stroke-width="1.75" />
              <input v-model="clienteBusqueda" type="search" placeholder="Buscar por nombre…" class="w-full rounded border border-brand-border py-2 pl-9 pr-3 text-sm font-normal focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue" @input="clienteAbierto = true; buscarClientes()" />
              <ul v-if="clienteAbierto && clienteOpciones.length" class="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded border border-brand-border-light bg-white shadow-lg">
                <li v-for="row in clienteOpciones" :key="row.id">
                  <button type="button" class="w-full px-3 py-2 text-left text-sm font-normal hover:bg-brand-bg" @click="elegirCliente(row)">
                    {{ row.customData?.nombre }} <span v-if="row.customData?.rfc" class="text-xs text-brand-text-muted">· {{ row.customData.rfc }}</span>
                  </button>
                </li>
              </ul>
            </div>
            <span class="text-xs font-normal text-brand-text-muted">Autocompleta los datos fiscales si el módulo Clientes los tiene; igual puedes editarlos abajo.</span>
          </div>
        </div>
        <div class="mt-4 grid gap-4 sm:grid-cols-2">
          <label class="flex flex-col gap-1.5 text-[13px] font-semibold text-brand-text">Nombre o razón social *
            <input v-model="receptor.nombre" maxlength="250" class="rounded border border-brand-border px-3 py-2 text-sm font-normal focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue" />
          </label>
          <label class="flex flex-col gap-1.5 text-[13px] font-semibold text-brand-text">RFC *
            <input v-model="receptor.rfc" maxlength="13" placeholder="AAA010101AAA" class="rounded border border-brand-border px-3 py-2 text-sm font-normal uppercase focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue" />
          </label>
          <label class="flex flex-col gap-1.5 text-[13px] font-semibold text-brand-text">Código postal *
            <input v-model="receptor.codigoPostal" maxlength="5" inputmode="numeric" class="rounded border border-brand-border px-3 py-2 text-sm font-normal focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue" />
          </label>
          <label class="flex flex-col gap-1.5 text-[13px] font-semibold text-brand-text">Régimen fiscal *
            <select v-model="receptor.regimenFiscal" class="rounded border border-brand-border bg-white px-3 py-2 text-sm font-normal focus:border-brand-blue focus:outline-none">
              <option value="">Selecciona…</option>
              <option v-for="r in REGIMENES_FISCALES" :key="r.value" :value="r.value">{{ r.label }}</option>
            </select>
          </label>
          <label class="flex flex-col gap-1.5 text-[13px] font-semibold text-brand-text sm:col-span-2">Correo (para enviarle el CFDI)
            <input v-model="receptor.correo" type="email" maxlength="200" class="rounded border border-brand-border px-3 py-2 text-sm font-normal focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue" />
          </label>
        </div>
        <div v-if="!esEdicion" class="mt-4 border-t border-brand-border-light pt-4">
          <span class="text-[13px] font-semibold text-brand-text">Origen (opcional)</span>
          <p class="mt-0.5 text-xs font-normal text-brand-text-muted">Vincula la cuenta por cobrar que da lugar a esta factura — es el vínculo que usan los complementos de pago para encontrarla.</p>
          <div v-if="sourceRecordId" class="mt-2 flex items-center justify-between rounded border border-brand-border-light bg-brand-bg px-3 py-2 text-sm">
            <span class="font-semibold text-brand-text">{{ sourceLabel }}</span>
            <button type="button" class="text-xs font-semibold text-brand-text-secondary hover:text-brand-error-text" @click="quitarSource">Quitar</button>
          </div>
          <div v-else class="relative mt-2">
            <Search class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-brand-text-muted" :stroke-width="1.75" />
            <input v-model="sourceBusqueda" type="search" placeholder="Buscar cuenta por cobrar por folio…" class="w-full rounded border border-brand-border py-2 pl-9 pr-3 text-sm focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue" @input="buscarSource" />
            <ul v-if="sourceAbierto && sourceOpciones.length" class="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded border border-brand-border-light bg-white shadow-lg">
              <li v-for="row in sourceOpciones" :key="row.id">
                <button type="button" class="w-full px-3 py-2 text-left text-sm hover:bg-brand-bg" @click="elegirSource(row)">{{ sourceRowLabel(row) }}</button>
              </li>
            </ul>
          </div>
        </div>
      </section>

      <section v-if="tipo === 'E'" class="mt-5 rounded-lg border border-brand-border-light bg-white p-5">
        <h2 class="text-[15px] font-bold text-brand-text">Factura relacionada</h2>
        <p class="mt-1 text-[13px] text-brand-text-secondary">Una nota de crédito debe relacionar un CFDI timbrado (tipo de relación SAT).</p>
        <div class="mt-4 grid gap-4 sm:grid-cols-2">
          <label class="flex flex-col gap-1.5 text-[13px] font-semibold text-brand-text">CFDI relacionado *
            <select v-model="relacionadoDocumentId" class="rounded border border-brand-border bg-white px-3 py-2 text-sm font-normal focus:border-brand-blue focus:outline-none">
              <option :value="null" disabled>Selecciona…</option>
              <option v-for="r in relacionables" :key="r.id" :value="r.id">{{ r.serie }}-{{ String(r.folio ?? 0).padStart(6, '0') }} · {{ r.receptorNombre }} · {{ formatoDinero(r.total, r.moneda) }}</option>
            </select>
          </label>
          <label class="flex flex-col gap-1.5 text-[13px] font-semibold text-brand-text">Tipo de relación *
            <select v-model="relacionadoTipo" class="rounded border border-brand-border bg-white px-3 py-2 text-sm font-normal focus:border-brand-blue focus:outline-none">
              <option v-for="t in TIPOS_RELACION" :key="t.value" :value="t.value">{{ t.label }}</option>
            </select>
          </label>
        </div>
      </section>

      <section class="mt-5 rounded-lg border border-brand-border-light bg-white p-5">
        <h2 class="text-[15px] font-bold text-brand-text">Conceptos</h2>
        <div v-for="(c, i) in conceptos" :key="i" class="mt-4 rounded border border-brand-border-light p-4">
          <div class="flex items-start justify-between gap-2">
            <div class="relative flex-1">
              <Search class="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-brand-text-muted" :stroke-width="1.75" />
              <input v-model="productoBusqueda[i]" type="search" placeholder="Buscar producto (opcional)…" class="w-full rounded border border-brand-border py-2 pl-9 pr-3 text-sm focus:border-brand-blue focus:outline-none" @input="buscarProducto(i)" />
              <ul v-if="productoAbierto[i] && productoOpciones[i]?.length" class="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded border border-brand-border-light bg-white shadow-lg">
                <li v-for="row in productoOpciones[i]" :key="row.id">
                  <button type="button" class="w-full px-3 py-2 text-left text-sm hover:bg-brand-bg" @click="elegirProducto(i, row)">{{ row.customData?.nombre }} <span v-if="row.customData?.sku" class="text-xs text-brand-text-muted">· {{ row.customData.sku }}</span></button>
                </li>
              </ul>
            </div>
            <button type="button" class="rounded border border-brand-border p-2 text-brand-text-secondary hover:bg-brand-bg disabled:opacity-40" :disabled="conceptos.length <= 1" title="Quitar concepto" @click="quitarConcepto(i)">
              <Trash2 class="h-4 w-4" :stroke-width="1.75" />
            </button>
          </div>
          <label class="mt-3 flex flex-col gap-1.5 text-[13px] font-semibold text-brand-text">Descripción *
            <input v-model="c.descripcion" maxlength="1000" class="rounded border border-brand-border px-3 py-2 text-sm font-normal focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue" />
          </label>
          <div class="mt-3 grid gap-3 sm:grid-cols-4">
            <label class="flex flex-col gap-1.5 text-[13px] font-semibold text-brand-text">ClaveProdServ *
              <input v-model="c.claveProdServ" maxlength="8" inputmode="numeric" placeholder="8 dígitos" class="rounded border border-brand-border px-3 py-2 text-sm font-normal focus:border-brand-blue focus:outline-none" />
            </label>
            <label class="flex flex-col gap-1.5 text-[13px] font-semibold text-brand-text">ClaveUnidad
              <input v-model="c.claveUnidad" maxlength="6" class="rounded border border-brand-border px-3 py-2 text-sm font-normal focus:border-brand-blue focus:outline-none" />
            </label>
            <label class="flex flex-col gap-1.5 text-[13px] font-semibold text-brand-text">Cantidad *
              <input v-model.number="c.cantidad" type="number" min="0.000001" step="any" class="rounded border border-brand-border px-3 py-2 text-sm font-normal focus:border-brand-blue focus:outline-none" />
            </label>
            <label class="flex flex-col gap-1.5 text-[13px] font-semibold text-brand-text">Valor unitario *
              <input v-model.number="c.valorUnitario" type="number" min="0" step="any" class="rounded border border-brand-border px-3 py-2 text-sm font-normal focus:border-brand-blue focus:outline-none" />
            </label>
            <label class="flex flex-col gap-1.5 text-[13px] font-semibold text-brand-text">Descuento línea
              <input v-model.number="c.descuento" type="number" min="0" step="any" class="rounded border border-brand-border px-3 py-2 text-sm font-normal focus:border-brand-blue focus:outline-none" />
            </label>
            <label class="flex flex-col gap-1.5 text-[13px] font-semibold text-brand-text">Traslado
              <select :value="trasladoPresetId(c)" class="rounded border border-brand-border bg-white px-3 py-2 text-sm font-normal focus:border-brand-blue focus:outline-none" @change="setTrasladoPreset(c, String(($event.target as HTMLSelectElement).value))">
                <option v-for="p in IMPUESTOS_PRESET" :key="p.id" :value="p.id">{{ p.label }}</option>
              </select>
            </label>
            <label class="flex flex-col gap-1.5 text-[13px] font-semibold text-brand-text sm:col-span-2">Importe
              <span class="rounded bg-brand-bg px-3 py-2 text-sm font-semibold tabular-nums">{{ formatoDinero(round6(c.cantidad * c.valorUnitario), moneda) }}</span>
            </label>
          </div>
        </div>
        <button type="button" class="mt-3 rounded border border-brand-border px-3 py-2 text-[13px] font-semibold text-brand-text hover:bg-brand-bg" @click="agregarConcepto">
          <span class="flex items-center gap-1.5"><Plus class="h-4 w-4" :stroke-width="1.75" />Agregar concepto</span>
        </button>
      </section>

      <section class="mt-5 rounded-lg border border-brand-border-light bg-white p-5">
        <h2 class="text-[15px] font-bold text-brand-text">Datos fiscales y totales</h2>
        <div class="mt-4 grid gap-4 sm:grid-cols-2">
          <label class="flex flex-col gap-1.5 text-[13px] font-semibold text-brand-text">Uso de CFDI *
            <select v-model="usoCfdi" class="rounded border border-brand-border bg-white px-3 py-2 text-sm font-normal focus:border-brand-blue focus:outline-none">
              <option v-for="u in USOS_CFDI" :key="u.value" :value="u.value">{{ u.label }}</option>
            </select>
          </label>
          <label class="flex flex-col gap-1.5 text-[13px] font-semibold text-brand-text">Método de pago
            <select v-model="metodoPago" class="rounded border border-brand-border bg-white px-3 py-2 text-sm font-normal focus:border-brand-blue focus:outline-none">
              <option v-for="m in METODOS_PAGO" :key="m.value" :value="m.value">{{ m.label }}</option>
            </select>
          </label>
          <label class="flex flex-col gap-1.5 text-[13px] font-semibold text-brand-text">Forma de pago
            <select v-model="formaPago" class="rounded border border-border bg-white px-3 py-2 text-sm font-normal focus:border-brand-blue focus:outline-none">
              <option :value="null">— (obligatoria al timbrar PUE)</option>
              <option v-for="f in FORMAS_PAGO" :key="f.value" :value="f.value">{{ f.label }}</option>
            </select>
          </label>
          <label class="flex flex-col gap-1.5 text-[13px] font-semibold text-brand-text">Moneda
            <select v-model="moneda" class="rounded border border-brand-border bg-white px-3 py-2 text-sm font-normal focus:border-brand-blue focus:outline-none">
              <option value="MXN">MXN · Peso mexicano</option>
              <option value="USD">USD · Dólar</option>
              <option value="EUR">EUR · Euro</option>
            </select>
          </label>
          <label v-if="moneda !== 'MXN'" class="flex flex-col gap-1.5 text-[13px] font-semibold text-brand-text">Tipo de cambio
            <input v-model.number="tipoCambio" type="number" min="0" step="any" class="rounded border border-brand-border px-3 py-2 text-sm font-normal focus:border-brand-blue focus:outline-none" />
          </label>
          <label class="flex flex-col gap-1.5 text-[13px] font-semibold text-brand-text">Exportación
            <select v-model="exportacion" class="rounded border border-brand-border bg-white px-3 py-2 text-sm font-normal focus:border-brand-blue focus:outline-none">
              <option v-for="e in EXPORTACION" :key="e.value" :value="e.value">{{ e.label }}</option>
            </select>
          </label>
          <label class="flex flex-col gap-1.5 text-[13px] font-semibold text-brand-text">Descuento global
            <input v-model.number="descuentoDocumento" type="number" min="0" step="any" class="rounded border border-brand-border px-3 py-2 text-sm font-normal focus:border-brand-blue focus:outline-none" />
          </label>
          <label class="flex flex-col gap-1.5 text-[13px] font-semibold text-brand-text">Observaciones
            <input v-model="observaciones" maxlength="500" class="rounded border border-brand-border px-3 py-2 text-sm font-normal focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue" />
          </label>
        </div>
        <div class="mt-5 rounded bg-brand-bg p-4 text-sm">
          <dl class="grid gap-1.5 sm:grid-cols-2">
            <div class="flex justify-between"><dt class="text-brand-text-secondary">Subtotal</dt><dd class="tabular-nums">{{ formatoDinero(totales.subtotal, moneda) }}</dd></div>
            <div class="flex justify-between"><dt class="text-brand-text-secondary">Traslados</dt><dd class="tabular-nums">{{ formatoDinero(totales.trasladado, moneda) }}</dd></div>
            <div class="flex justify-between"><dt class="text-brand-text-secondary">Retenciones</dt><dd class="tabular-nums">−{{ formatoDinero(totales.retenido, moneda) }}</dd></div>
            <div class="flex justify-between font-bold"><dt>Total</dt><dd class="tabular-nums">{{ formatoDinero(totales.total, moneda) }}</dd></div>
          </dl>
          <p class="mt-2 text-xs text-brand-text-muted">Vista previa: los totales oficiales los recalcula el servidor al guardar.</p>
        </div>
      </section>
    </template>

    <p v-if="formError" role="alert" class="mt-4 rounded bg-brand-error-bg p-3 text-sm text-brand-error-text">{{ formError }}</p>
    <div class="mt-5 flex items-center gap-3">
      <button type="button" class="rounded bg-brand-orange px-4 py-2 text-[13px] font-semibold text-white hover:bg-brand-orange-hover disabled:opacity-50" :disabled="saving" @click="submit">
        {{ saving ? 'Guardando…' : esEdicion ? 'Guardar cambios' : 'Crear borrador' }}
      </button>
      <NuxtLink to="/facturacion" class="rounded border border-brand-border px-4 py-2 text-[13px] font-semibold text-brand-text-secondary hover:bg-brand-bg">Cancelar</NuxtLink>
    </div>
  </div>
</template>
