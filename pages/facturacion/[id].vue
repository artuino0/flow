<script setup lang="ts">
import { ArrowLeft, Download, FileText, Mail, Ban, Stamp, Pencil, Trash2, FileMinus, WalletCards, Landmark } from '@lucide/vue'
import {
  ESTADOS_CFDI,
  EXPORTACION,
  FORMAS_PAGO,
  MOTIVOS_CANCELACION,
  REGIMENES_FISCALES,
  TIPO_CFDI_LABEL,
  TIPOS_RELACION,
  USOS_CFDI,
  catalogoLabel,
  formatoDinero,
  formatoFecha,
  formatoFechaHora
} from '~/utils/cfdiCatalogos'

// Fase C/D/F/G de DOCS/HU_Timbrado_CFDI_PAC.md: detalle del documento fiscal
// con su máquina de estados y la línea de tiempo append-only (cfdi_events).
definePageMeta({ layout: 'default' })

const route = useRoute()
const router = useRouter()
const toast = useToast()
const documentId = String(route.params.id)

interface Detalle {
  documento: Record<string, any>
  serie: { id: string; serie: string; tipoComprobante: string; lugarExpedicion: string }
  conceptos: Array<Record<string, any>>
  pagos: Array<Record<string, any>>
  relacionado: Record<string, any> | null
  events: Array<Record<string, any>>
}

const detail = ref<Detalle | null>(null)
const loading = ref(true)
const loadError = ref('')
const accionCorriendo = ref('')
const mostrarCancelar = ref(false)
const cancelMotivo = ref('03')
const cancelSustituto = ref('')
const mostrarEnviar = ref(false)
const enviarPara = ref('')

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    detail.value = await $fetch<Detalle>(`/api/facturacion/documents/${documentId}`)
  } catch (err: any) {
    loadError.value = err?.data?.statusMessage || 'No se pudo cargar el documento'
    detail.value = null
  } finally {
    loading.value = false
  }
}
onMounted(load)

const doc = computed(() => detail.value?.documento ?? null)
const estado = computed(() => doc.value?.estado ?? '')
const folioTexto = computed(() => {
  if (!doc.value || !detail.value) return '—'
  return doc.value.folio != null ? `${detail.value.serie.serie}-${String(doc.value.folio).padStart(6, '0')}` : `${detail.value.serie.serie}-borrador`
})
// Un complemento (P) no se edita a mano: se borra el borrador y se regenera
// desde el cobro (su forma depende de las aplicaciones del mundo dinámico).
const puedeEditar = computed(() => ['borrador', 'error'].includes(estado.value) && !doc.value?.uuidFiscal && doc.value?.tipo !== 'P')
const puedeEliminar = computed(() => estado.value === 'borrador' && doc.value?.folio == null)
const puedeTimbrar = computed(() => ['borrador', 'error', 'timbrando'].includes(estado.value))
const puedeCancelar = computed(() => estado.value === 'timbrada')

async function timbrar() {
  accionCorriendo.value = 'timbrar'
  try {
    await $fetch(`/api/facturacion/documents/${documentId}/timbrar`, { method: 'POST' })
    toast.success('Documento timbrado', 'El CFDI ya tiene UUID fiscal, XML y PDF.')
    await load()
  } catch (err: any) {
    toast.error('No se pudo timbrar', err?.data?.statusMessage || 'Revisa el mensaje del PAC')
    await load()
  } finally {
    accionCorriendo.value = ''
  }
}

async function cancelar() {
  accionCorriendo.value = 'cancelar'
  try {
    await $fetch(`/api/facturacion/documents/${documentId}/cancelar`, {
      method: 'POST',
      body: { motivo: cancelMotivo.value, folioSustitucion: cancelMotivo.value === '01' ? cancelSustituto.value.trim() : null }
    })
    toast.success('Cancelación confirmada', 'El PAC confirmó la cancelación ante el SAT.')
    mostrarCancelar.value = false
    await load()
  } catch (err: any) {
    toast.error('No se pudo cancelar', err?.data?.statusMessage || 'Intenta de nuevo')
  } finally {
    accionCorriendo.value = ''
  }
}

async function eliminar() {
  if (!window.confirm('¿Eliminar este borrador? No se puede deshacer (no consume folio).')) return
  accionCorriendo.value = 'eliminar'
  try {
    await $fetch(`/api/facturacion/documents/${documentId}`, { method: 'DELETE' })
    toast.success('Borrador eliminado')
    await router.push('/facturacion')
  } catch (err: any) {
    toast.error('No se pudo eliminar', err?.data?.statusMessage || 'Intenta de nuevo')
    accionCorriendo.value = ''
  }
}

async function enviar() {
  accionCorriendo.value = 'enviar'
  try {
    const res = await $fetch<{ para: string }>(`/api/facturacion/documents/${documentId}/enviar`, { method: 'POST', body: { para: enviarPara.value.trim() || null } })
    toast.success('CFDI enviado', `XML y PDF enviados a ${res.para}.`)
    mostrarEnviar.value = false
    await load()
  } catch (err: any) {
    toast.error('No se pudo enviar', err?.data?.statusMessage || 'Revisa la configuración de correo')
  } finally {
    accionCorriendo.value = ''
  }
}

const EVENTO_LABEL: Record<string, string> = {
  folio_asignado: 'Folio asignado',
  intento_timbrado: 'Intento de timbrado',
  timbrado_ok: 'Timbrado correcto',
  error_pac: 'Error del PAC',
  verificacion_getstatus: 'Verificación con el PAC',
  cancelacion_solicitada: 'Cancelación solicitada',
  cancelacion_confirmada: 'Cancelación confirmada',
  email_enviado: 'Enviado por correo'
}
</script>

<template>
  <div class="mx-auto min-h-[calc(100vh-120px)] max-w-5xl pb-16">
    <NuxtLink to="/facturacion" class="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-text-secondary hover:text-brand-blue">
      <ArrowLeft class="h-4 w-4" :stroke-width="1.75" /> Volver a Facturación
    </NuxtLink>

    <p v-if="loading" role="status" class="mt-6 text-sm text-brand-text-muted">Cargando documento…</p>
    <div v-else-if="!detail || !doc" role="alert" class="mt-6 rounded-lg border border-brand-border-light bg-white p-6 text-sm text-brand-error-text">
      {{ loadError }}
    </div>

    <template v-else>
      <header class="mt-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div class="flex items-center gap-2">
            <component :is="doc.tipo === 'I' ? FileText : doc.tipo === 'E' ? FileMinus : WalletCards" class="h-5 w-5 text-brand-blue" :stroke-width="1.75" />
            <h1 class="text-[22px] font-bold text-brand-text">{{ folioTexto }}</h1>
            <span class="rounded px-2 py-0.5 text-xs font-semibold" :class="ESTADOS_CFDI[estado]?.badge ?? 'bg-brand-bg'">{{ ESTADOS_CFDI[estado]?.label ?? estado }}</span>
          </div>
          <p class="mt-1 text-sm text-brand-text-secondary">
            {{ TIPO_CFDI_LABEL[doc.tipo] }} · {{ doc.receptorNombre }} · {{ formatoDinero(doc.total, doc.moneda) }}
          </p>
        </div>
        <div class="flex flex-wrap gap-2">
          <NuxtLink v-if="puedeEditar" :to="`/facturacion/nuevo?id=${doc.id}`" class="rounded border border-brand-border bg-white px-3 py-2 text-[13px] font-semibold text-brand-text hover:bg-brand-bg">
            <span class="flex items-center gap-1.5"><Pencil class="h-4 w-4" :stroke-width="1.75" />Editar</span>
          </NuxtLink>
          <button v-if="puedeEliminar" type="button" class="rounded border border-brand-border bg-white px-3 py-2 text-[13px] font-semibold text-brand-text-secondary hover:bg-brand-bg" :disabled="accionCorriendo === 'eliminar'" @click="eliminar">
            <span class="flex items-center gap-1.5"><Trash2 class="h-4 w-4" :stroke-width="1.75" />Eliminar</span>
          </button>
          <button v-if="puedeTimbrar" type="button" class="rounded bg-brand-orange px-3 py-2 text-[13px] font-semibold text-white hover:bg-brand-orange-hover disabled:opacity-50" :disabled="accionCorriendo === 'timbrar'" @click="timbrar">
            <span class="flex items-center gap-1.5"><Stamp class="h-4 w-4" :stroke-width="1.75" />{{ accionCorriendo === 'timbrar' ? 'Timbrando…' : estado === 'error' ? 'Reintentar timbrado' : estado === 'timbrando' ? 'Verificar y timbrar' : 'Timbrar' }}</span>
          </button>
          <template v-if="estado === 'timbrada'">
            <a :href="`/api/facturacion/documents/${doc.id}/xml`" class="rounded border border-brand-border bg-white px-3 py-2 text-[13px] font-semibold text-brand-text hover:bg-brand-bg">
              <span class="flex items-center gap-1.5"><Download class="h-4 w-4" :stroke-width="1.75" />XML</span>
            </a>
            <a :href="`/api/facturacion/documents/${doc.id}/pdf`" class="rounded border border-brand-border bg-white px-3 py-2 text-[13px] font-semibold text-brand-text hover:bg-brand-bg">
              <span class="flex items-center gap-1.5"><Download class="h-4 w-4" :stroke-width="1.75" />PDF</span>
            </a>
            <button type="button" class="rounded border border-brand-border bg-white px-3 py-2 text-[13px] font-semibold text-brand-text hover:bg-brand-bg" @click="enviarPara = doc.receptorCorreo ?? ''; mostrarEnviar = true">
              <span class="flex items-center gap-1.5"><Mail class="h-4 w-4" :stroke-width="1.75" />Enviar</span>
            </button>
            <NuxtLink v-if="doc.tipo === 'I'" :to="`/facturacion/nuevo?tipo=E&relacionado=${doc.id}`" class="rounded border border-brand-border bg-white px-3 py-2 text-[13px] font-semibold text-brand-text hover:bg-brand-bg">
              <span class="flex items-center gap-1.5"><FileMinus class="h-4 w-4" :stroke-width="1.75" />Nota de crédito</span>
            </NuxtLink>
            <button type="button" class="rounded border border-brand-error-text px-3 py-2 text-[13px] font-semibold text-brand-error-text hover:bg-brand-error-bg" @click="mostrarCancelar = true">
              <span class="flex items-center gap-1.5"><Ban class="h-4 w-4" :stroke-width="1.75" />Cancelar ante el SAT</span>
            </button>
          </template>
        </div>
      </header>

      <div v-if="estado === 'error' && doc.mensajePac" role="alert" class="mt-4 rounded bg-brand-error-bg p-3 text-sm text-brand-error-text">
        <strong>Mensaje del PAC:</strong> {{ doc.mensajePac }}
      </div>
      <div v-if="estado === 'timbrando'" role="status" class="mt-4 rounded bg-brand-blue-bg p-3 text-sm text-brand-blue">
        El documento quedó en estado "timbrando" (intento anterior interrumpido). Al reintentar, FlowERP primero verifica con el PAC si ya se timbró, para no duplicar.
      </div>

      <div class="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div class="space-y-5">
          <section class="rounded-lg border border-brand-border-light bg-white p-5">
            <h2 class="text-[15px] font-bold text-brand-text">Datos del comprobante</h2>
            <dl class="mt-4 grid gap-4 text-sm sm:grid-cols-2">
              <div><dt class="text-xs text-brand-text-muted">UUID fiscal</dt><dd class="mt-0.5 break-all font-mono text-xs">{{ doc.uuidFiscal || '—' }}</dd></div>
              <div><dt class="text-xs text-brand-text-muted">Fecha de timbrado</dt><dd class="mt-0.5">{{ formatoFechaHora(doc.fechaTimbrado) }}</dd></div>
              <div><dt class="text-xs text-brand-text-muted">Emisor</dt><dd class="mt-0.5">{{ doc.emisorNombre || '—' }} <span v-if="doc.emisorRfc" class="text-brand-text-muted">· {{ doc.emisorRfc }}</span></dd></div>
              <div><dt class="text-xs text-brand-text-muted">Régimen / CP emisor</dt><dd class="mt-0.5">{{ doc.emisorRegimenFiscal || '—' }} · {{ doc.emisorCodigoPostal || '—' }}</dd></div>
              <div><dt class="text-xs text-brand-text-muted">Receptor</dt><dd class="mt-0.5">{{ doc.receptorNombre }} <span v-if="doc.receptorRfc" class="text-brand-text-muted">· {{ doc.receptorRfc }}</span></dd></div>
              <div><dt class="text-xs text-brand-text-muted">Régimen / CP receptor</dt><dd class="mt-0.5">{{ catalogoLabel(REGIMENES_FISCALES, doc.receptorRegimenFiscal) }} · {{ doc.receptorCodigoPostal || '—' }}</dd></div>
              <div><dt class="text-xs text-brand-text-muted">Uso de CFDI</dt><dd class="mt-0.5">{{ catalogoLabel(USOS_CFDI, doc.usoCfdi) }}</dd></div>
              <div><dt class="text-xs text-brand-text-muted">Forma / método de pago</dt><dd class="mt-0.5">{{ doc.formaPago ? catalogoLabel(FORMAS_PAGO, doc.formaPago) : '—' }} · {{ doc.metodoPago }}</dd></div>
              <div><dt class="text-xs text-brand-text-muted">Moneda{{ doc.tipoCambio ? ` (TC ${doc.tipoCambio})` : '' }}</dt><dd class="mt-0.5">{{ doc.moneda }}</dd></div>
              <div><dt class="text-xs text-brand-text-muted">Exportación</dt><dd class="mt-0.5">{{ catalogoLabel(EXPORTACION, doc.exportacion) }}</dd></div>
              <div v-if="doc.fechaPago"><dt class="text-xs text-brand-text-muted">Fecha de pago</dt><dd class="mt-0.5">{{ formatoFechaHora(doc.fechaPago) }}</dd></div>
              <div v-if="doc.intentos"><dt class="text-xs text-brand-text-muted">Intentos de timbrado</dt><dd class="mt-0.5">{{ doc.intentos }}</dd></div>
            </dl>
            <div v-if="detail.relacionado" class="mt-4 rounded border border-brand-border-light bg-brand-bg p-3 text-sm">
              <span class="font-semibold">CFDI relacionado:</span>
              <NuxtLink :to="`/facturacion/${detail.relacionado.id}`" class="ml-1 font-semibold text-brand-blue hover:underline">
                {{ detail.relacionado.folio != null ? `${detail.relacionado.folio}` : 'borrador' }} · {{ detail.relacionado.receptorNombre }} · {{ formatoDinero(detail.relacionado.total, detail.relacionado.moneda) }}
              </NuxtLink>
              <span class="ml-1 text-brand-text-muted">({{ catalogoLabel(TIPOS_RELACION, doc.tipoRelacion) }})</span>
            </div>
            <p v-if="doc.observaciones" class="mt-3 text-sm text-brand-text-secondary">{{ doc.observaciones }}</p>
          </section>

          <section v-if="doc.tipo !== 'P'" class="rounded-lg border border-brand-border-light bg-white p-5">
            <h2 class="text-[15px] font-bold text-brand-text">Conceptos ({{ detail.conceptos.length }})</h2>
            <div class="mt-3 overflow-x-auto">
              <table class="w-full text-sm">
                <thead>
                  <tr class="border-b border-brand-border-light text-left text-xs uppercase tracking-wide text-brand-text-muted">
                    <th class="px-2 py-2 font-semibold">Descripción</th>
                    <th class="px-2 py-2 font-semibold">Claves SAT</th>
                    <th class="px-2 py-2 text-right font-semibold">Cant.</th>
                    <th class="px-2 py-2 text-right font-semibold">Unitario</th>
                    <th class="px-2 py-2 text-right font-semibold">Importe</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="c in detail.conceptos" :key="c.orden" class="border-b border-brand-border-light last:border-0 align-top">
                    <td class="px-2 py-2">{{ c.descripcion }}</td>
                    <td class="px-2 py-2 font-mono text-xs text-brand-text-muted">{{ c.claveProdServ }} · {{ c.claveUnidad }}</td>
                    <td class="px-2 py-2 text-right tabular-nums">{{ c.cantidad }}</td>
                    <td class="px-2 py-2 text-right tabular-nums">{{ c.valorUnitario }}</td>
                    <td class="px-2 py-2 text-right tabular-nums">{{ c.importe }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <dl class="mt-4 grid gap-1.5 border-t border-brand-border-light pt-4 text-sm sm:grid-cols-2">
              <div class="flex justify-between"><dt class="text-brand-text-secondary">Subtotal</dt><dd class="tabular-nums">{{ formatoDinero(doc.subtotal, doc.moneda) }}</dd></div>
              <div class="flex justify-between"><dt class="text-brand-text-secondary">Descuentos</dt><dd class="tabular-nums">−{{ formatoDinero(doc.descuento, doc.moneda) }}</dd></div>
              <div v-for="(t, i) in (doc.impuestos?.traslados ?? [])" :key="`t${i}`" class="flex justify-between">
                <dt class="text-brand-text-secondary">Traslado {{ t.impuesto }} {{ t.tipoFactor }} {{ (Number(t.tasaOCuota) * 100).toFixed(2) }}%</dt>
                <dd class="tabular-nums">{{ formatoDinero(t.importe, doc.moneda) }}</dd>
              </div>
              <div v-for="(r, i) in (doc.impuestos?.retenciones ?? [])" :key="`r${i}`" class="flex justify-between">
                <dt class="text-brand-text-secondary">Retención {{ r.impuesto }}</dt>
                <dd class="tabular-nums">−{{ formatoDinero(r.importe, doc.moneda) }}</dd>
              </div>
              <div class="flex justify-between font-bold"><dt>Total</dt><dd class="tabular-nums">{{ formatoDinero(doc.total, doc.moneda) }}</dd></div>
            </dl>
          </section>

          <section v-if="doc.tipo === 'P' && detail.pagos.length" class="rounded-lg border border-brand-border-light bg-white p-5">
            <h2 class="text-[15px] font-bold text-brand-text">Documentos relacionados ({{ detail.pagos.length }})</h2>
            <div class="mt-3 overflow-x-auto">
              <table class="w-full text-sm">
                <thead>
                  <tr class="border-b border-brand-border-light text-left text-xs uppercase tracking-wide text-brand-text-muted">
                    <th class="px-2 py-2 font-semibold">CFDI</th>
                    <th class="px-2 py-2 font-semibold">Parc.</th>
                    <th class="px-2 py-2 text-right font-semibold">Saldo ant.</th>
                    <th class="px-2 py-2 text-right font-semibold">Pagado</th>
                    <th class="px-2 py-2 text-right font-semibold">Saldo ins.</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="p in detail.pagos" :key="p.id" class="border-b border-brand-border-light last:border-0">
                    <td class="px-2 py-2">
                      <NuxtLink :to="`/facturacion/${p.relacionado.id}`" class="font-semibold text-brand-blue hover:underline">
                        {{ p.relacionado.folio != null ? `#${p.relacionado.folio}` : '—' }} {{ p.relacionado.receptorNombre }}
                      </NuxtLink>
                      <span class="block font-mono text-[11px] text-brand-text-muted">{{ p.uuidFiscal || p.relacionado.uuidFiscal }}</span>
                    </td>
                    <td class="px-2 py-2 tabular-nums">{{ p.numParcialidad ?? '—' }}</td>
                    <td class="px-2 py-2 text-right tabular-nums">{{ formatoDinero(p.impSaldoAnt, p.monedaDr) }}</td>
                    <td class="px-2 py-2 text-right tabular-nums">{{ formatoDinero(p.impPagado, p.monedaDr) }}</td>
                    <td class="px-2 py-2 text-right tabular-nums">{{ formatoDinero(p.impSaldoIns, p.monedaDr) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <aside class="space-y-5">
          <section class="rounded-lg border border-brand-border-light bg-white p-5">
            <h2 class="flex items-center gap-2 text-[15px] font-bold text-brand-text"><Landmark class="h-4 w-4 text-brand-blue" :stroke-width="1.75" />Historial fiscal</h2>
            <p class="mt-1 text-[13px] text-brand-text-secondary">Registro append-only de intentos, acuses y envíos.</p>
            <ol v-if="detail.events.length" class="mt-4 space-y-3">
              <li v-for="ev in [...detail.events].reverse()" :key="ev.id" class="border-l-2 border-brand-border-light pl-3">
                <p class="text-[13px] font-semibold text-brand-text">{{ EVENTO_LABEL[ev.tipo] ?? ev.tipo }}</p>
                <p class="text-xs text-brand-text-muted">{{ formatoFechaHora(ev.createdAt) }}</p>
                <p v-if="ev.detalle?.message" class="mt-0.5 break-words text-xs text-brand-error-text">{{ ev.detalle.message }}</p>
                <p v-else-if="ev.detalle?.folio" class="mt-0.5 text-xs text-brand-text-secondary">Folio {{ ev.detalle.folio }}{{ ev.detalle.serie ? ` · serie ${ev.detalle.serie}` : '' }}</p>
                <p v-else-if="ev.detalle?.uuid" class="mt-0.5 break-all font-mono text-[11px] text-brand-text-secondary">{{ ev.detalle.uuid }}{{ ev.detalle.adoptado ? ' · adoptado del PAC' : '' }}</p>
                <p v-else-if="ev.detalle?.para" class="mt-0.5 text-xs text-brand-text-secondary">Para {{ ev.detalle.para }}</p>
              </li>
            </ol>
            <p v-else class="mt-4 text-sm text-brand-text-muted">Sin eventos todavía.</p>
          </section>
        </aside>
      </div>
    </template>

    <!-- Modal cancelar -->
    <div v-if="mostrarCancelar" class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" @click.self="mostrarCancelar = false">
      <div class="w-full max-w-md rounded-lg border border-brand-border-light bg-white p-6">
        <h2 class="text-[15px] font-bold text-brand-text">Cancelar CFDI ante el SAT</h2>
        <p class="mt-1 text-[13px] text-brand-text-secondary">Esta acción es irreversible: el PAC enviará la solicitud de cancelación con el motivo seleccionado.</p>
        <label class="mt-4 flex flex-col gap-1.5 text-[13px] font-semibold text-brand-text">Motivo de cancelación
          <select v-model="cancelMotivo" class="rounded border border-brand-border bg-white px-3 py-2 text-sm font-normal focus:border-brand-blue focus:outline-none">
            <option v-for="m in MOTIVOS_CANCELACION" :key="m.value" :value="m.value">{{ m.label }}</option>
          </select>
        </label>
        <label v-if="cancelMotivo === '01'" class="mt-3 flex flex-col gap-1.5 text-[13px] font-semibold text-brand-text">UUID del comprobante sustituto *
          <input v-model="cancelSustituto" placeholder="00000000-0000-0000-0000-000000000000" class="rounded border border-brand-border px-3 py-2 font-mono text-sm font-normal focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue" />
        </label>
        <div class="mt-5 flex justify-end gap-2">
          <button type="button" class="rounded border border-brand-border px-4 py-2 text-[13px] font-semibold text-brand-text-secondary hover:bg-brand-bg" @click="mostrarCancelar = false">Volver</button>
          <button type="button" class="rounded bg-brand-error-text px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-50" :disabled="accionCorriendo === 'cancelar'" @click="cancelar">{{ accionCorriendo === 'cancelar' ? 'Cancelando…' : 'Cancelar CFDI' }}</button>
        </div>
      </div>
    </div>

    <!-- Modal enviar -->
    <div v-if="mostrarEnviar" class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" @click.self="mostrarEnviar = false">
      <div class="w-full max-w-md rounded-lg border border-brand-border-light bg-white p-6">
        <h2 class="text-[15px] font-bold text-brand-text">Enviar CFDI por correo</h2>
        <p class="mt-1 text-[13px] text-brand-text-secondary">Se adjuntan el XML y el PDF timbrados.</p>
        <label class="mt-4 flex flex-col gap-1.5 text-[13px] font-semibold text-brand-text">Correo destino
          <input v-model="enviarPara" type="email" :placeholder="doc?.receptorCorreo || 'receptor@ejemplo.mx'" class="rounded border border-brand-border px-3 py-2 text-sm font-normal focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue" />
        </label>
        <div class="mt-5 flex justify-end gap-2">
          <button type="button" class="rounded border border-brand-border px-4 py-2 text-[13px] font-semibold text-brand-text-secondary hover:bg-brand-bg" @click="mostrarEnviar = false">Volver</button>
          <button type="button" class="rounded bg-brand-orange px-4 py-2 text-[13px] font-semibold text-white hover:bg-brand-orange-hover disabled:opacity-50" :disabled="accionCorriendo === 'enviar'" @click="enviar">{{ accionCorriendo === 'enviar' ? 'Enviando…' : 'Enviar' }}</button>
        </div>
      </div>
    </div>
  </div>
</template>
