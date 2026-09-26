<script setup lang="ts">
import { ArrowLeft, Download, FileText, Mail, Ban, Stamp, Pencil, Trash2, FileMinus, WalletCards, Landmark, Printer } from '@lucide/vue'
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
const { confirm: confirmAction } = useConfirm()
const documentId = String(route.params.id)

interface Detalle {
  documento: Record<string, any>
  serie: { id: string; serie: string; tipoComprobante: string; lugarExpedicion: string }
  conceptos: Array<Record<string, any>>
  pagos: Array<Record<string, any>>
  relacionado: Record<string, any> | null
  relaciones: Array<Record<string, any>>
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
  if (!await confirmAction({ title: 'Eliminar borrador', message: '¿Eliminar este borrador? No se puede deshacer y no consume folio.', confirmLabel: 'Eliminar', destructive: true })) return
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

function timelineTone(tipo: string) {
  if (tipo === 'error_pac') return 'error'
  if (tipo === 'timbrado_ok' || tipo === 'cancelacion_confirmada') return 'success'
  if (tipo === 'cancelacion_solicitada') return 'warning'
  return 'info'
}
</script>

<template>
  <div class="cfdi-detail-page">
    <NuxtLink to="/facturacion" class="cfdi-back"><ArrowLeft class="h-4 w-4" :stroke-width="1.75" /> Volver a Facturación</NuxtLink>

    <p v-if="loading" role="status" class="cfdi-state-message">Cargando factura…</p>
    <div v-else-if="!detail || !doc" role="alert" class="cfdi-error-state">
      <strong>No se pudo cargar la factura</strong>
      <span>{{ loadError || 'Verifica tu conexión a internet e intenta de nuevo.' }}</span>
      <button type="button" class="cfdi-btn cfdi-btn-outline" @click="load">Reintentar</button>
    </div>

    <template v-else>
      <div class="cfdi-topline">
        <div class="cfdi-breadcrumb">Inicio <span>/</span> Facturación <span>/</span> <strong>{{ folioTexto }}</strong></div>
        <div class="cfdi-environment">Ambiente de pruebas</div>
      </div>

      <header class="cfdi-header-card">
        <div class="cfdi-header-main">
          <div class="cfdi-doc-icon"><component :is="doc.tipo === 'I' ? FileText : doc.tipo === 'E' ? FileMinus : WalletCards" class="h-5 w-5" :stroke-width="1.8" /></div>
          <div class="cfdi-title-block">
            <div class="cfdi-title-line"><h1>{{ folioTexto }}</h1><span class="cfdi-status" :class="`status-${estado}`">{{ ESTADOS_CFDI[estado]?.label ?? estado }}</span></div>
            <p>{{ TIPO_CFDI_LABEL[doc.tipo] }} <span>·</span> {{ doc.receptorNombre || 'Sin receptor' }}</p>
          </div>
        </div>
        <div class="cfdi-total-block"><span>Total</span><strong>{{ formatoDinero(doc.total, doc.moneda) }} {{ doc.moneda }}</strong></div>
        <div class="cfdi-action-row">
          <NuxtLink v-if="puedeEditar" :to="`/facturacion/nuevo?id=${doc.id}`" class="cfdi-btn cfdi-btn-outline"><Pencil class="h-4 w-4" :stroke-width="1.75" />Editar</NuxtLink>
          <button v-if="puedeEliminar" type="button" class="cfdi-btn cfdi-btn-outline" :disabled="accionCorriendo === 'eliminar'" @click="eliminar"><Trash2 class="h-4 w-4" :stroke-width="1.75" />Eliminar</button>
          <button v-if="puedeTimbrar" type="button" class="cfdi-btn cfdi-btn-primary" :disabled="accionCorriendo === 'timbrar'" @click="timbrar"><Stamp class="h-4 w-4" :stroke-width="1.75" />{{ accionCorriendo === 'timbrar' ? 'Timbrando…' : estado === 'error' ? 'Reintentar timbrado' : 'Timbrar' }}</button>
          <NuxtLink v-if="estado !== 'timbrada'" :to="`/facturacion-print/${doc.id}`" target="_blank" class="cfdi-btn cfdi-btn-outline"><Printer class="h-4 w-4" :stroke-width="1.75" />PDF Flow</NuxtLink>
          <template v-if="estado === 'timbrada'">
            <NuxtLink :to="`/facturacion-print/${doc.id}`" target="_blank" class="cfdi-btn cfdi-btn-outline"><Printer class="h-4 w-4" :stroke-width="1.75" />PDF Flow</NuxtLink>
            <a :href="`/api/facturacion/documents/${doc.id}/xml`" class="cfdi-btn cfdi-btn-outline"><Download class="h-4 w-4" :stroke-width="1.75" />XML</a>
            <a :href="`/api/facturacion/documents/${doc.id}/pdf`" class="cfdi-btn cfdi-btn-outline"><Download class="h-4 w-4" :stroke-width="1.75" />PDF</a>
            <button type="button" class="cfdi-btn cfdi-btn-outline" @click="enviarPara = doc.receptorCorreo ?? ''; mostrarEnviar = true"><Mail class="h-4 w-4" :stroke-width="1.75" />Enviar</button>
            <NuxtLink v-if="doc.tipo === 'I'" :to="`/facturacion/nuevo?tipo=E&relacionado=${doc.id}`" class="cfdi-btn cfdi-btn-outline"><FileMinus class="h-4 w-4" :stroke-width="1.75" />Nota de crédito</NuxtLink>
            <button type="button" class="cfdi-btn cfdi-btn-danger" @click="mostrarCancelar = true"><Ban class="h-4 w-4" :stroke-width="1.75" />Cancelar ante el SAT</button>
          </template>
        </div>
      </header>

      <div v-if="estado === 'error' && doc.mensajePac" role="alert" class="cfdi-alert cfdi-alert-error"><span class="cfdi-alert-icon">!</span><div><strong>No se pudo timbrar</strong><p>{{ doc.mensajePac }}</p><small>Revisa los datos fiscales del receptor y vuelve a intentar el timbrado.</small></div></div>
      <div v-else-if="estado === 'timbrando'" role="status" class="cfdi-alert cfdi-alert-info"><span class="cfdi-alert-icon">↻</span><div><strong>Timbrando comprobante</strong><p>Enviando comprobante al PAC para su timbrado…</p></div></div>
      <div v-else-if="estado === 'timbrada'" role="status" class="cfdi-alert cfdi-alert-success"><span class="cfdi-alert-icon">✓</span><div><strong>CFDI timbrado correctamente</strong><p>UUID: {{ doc.uuidFiscal || '—' }} <span>·</span> Timbrado el {{ formatoFechaHora(doc.fechaTimbrado) }}</p></div></div>

      <div class="cfdi-columns">
        <main class="cfdi-main-column">
          <section class="cfdi-card">
            <header class="cfdi-card-header"><div><h2>Datos del comprobante</h2><p>Información fiscal del CFDI.</p></div></header>
            <dl class="cfdi-detail-grid">
              <div><dt>UUID fiscal</dt><dd class="cfdi-mono">{{ doc.uuidFiscal || '—' }}</dd></div>
              <div><dt>Serie y folio</dt><dd>{{ folioTexto }}</dd></div>
              <div><dt>Tipo de comprobante</dt><dd>{{ TIPO_CFDI_LABEL[doc.tipo] }} ({{ doc.tipo }})</dd></div>
              <div><dt>Fecha de emisión</dt><dd>{{ formatoFechaHora(doc.fechaEmision || doc.createdAt) }}</dd></div>
              <div><dt>Fecha de timbrado</dt><dd>{{ formatoFechaHora(doc.fechaTimbrado) }}</dd></div>
              <div><dt>Moneda / tipo de cambio</dt><dd>{{ doc.moneda }} <span v-if="doc.tipoCambio">· {{ doc.tipoCambio }}</span><span v-else>· 1.00</span></dd></div>
              <div><dt>Forma de pago</dt><dd>{{ doc.formaPago ? catalogoLabel(FORMAS_PAGO, doc.formaPago) : '—' }}</dd></div>
              <div><dt>Método de pago</dt><dd>{{ doc.metodoPago || '—' }}</dd></div>
              <div><dt>Uso de CFDI</dt><dd>{{ catalogoLabel(USOS_CFDI, doc.usoCfdi) }}</dd></div>
              <div><dt>Exportación</dt><dd>{{ catalogoLabel(EXPORTACION, doc.exportacion) }}</dd></div>
              <div><dt>Intentos de timbrado</dt><dd>{{ doc.intentos || 0 }}</dd></div>
            </dl>
          </section>

          <section class="cfdi-card">
            <header class="cfdi-card-header"><div><h2>Datos del receptor</h2><p>Información fiscal del cliente.</p></div></header>
            <dl class="cfdi-detail-grid cfdi-receptor-grid">
              <div><dt>Razón social</dt><dd>{{ doc.receptorNombre || '—' }}</dd></div>
              <div><dt>RFC</dt><dd>{{ doc.receptorRfc || '—' }}</dd></div>
              <div><dt>Régimen fiscal</dt><dd>{{ catalogoLabel(REGIMENES_FISCALES, doc.receptorRegimenFiscal) }}</dd></div>
              <div><dt>Código postal</dt><dd>{{ doc.receptorCodigoPostal || '—' }}</dd></div>
              <div><dt>Uso de CFDI</dt><dd>{{ catalogoLabel(USOS_CFDI, doc.usoCfdi) }}</dd></div>
              <div><dt>Correo electrónico</dt><dd>{{ doc.receptorCorreo || '—' }}</dd></div>
            </dl>
            <div v-if="detail.relacionado" class="cfdi-related-note"><span>Registro de cliente:</span> {{ detail.relacionado.receptorNombre || doc.receptorNombre }}</div>
          </section>

          <section v-if="doc.tipo !== 'P'" class="cfdi-card">
            <header class="cfdi-card-header"><div><h2>Conceptos <span class="cfdi-count">{{ detail.conceptos.length }}</span></h2><p>Productos y servicios incluidos en el comprobante.</p></div></header>
            <div v-if="detail.conceptos.length" class="cfdi-concepts-wrap">
              <table class="cfdi-concepts"><thead><tr><th>Descripción</th><th>Clave SAT</th><th>Unidad</th><th>Cant.</th><th class="numeric">P. unitario</th><th class="numeric">Descuento</th><th class="numeric">Importe</th></tr></thead>
                <tbody><tr v-for="c in detail.conceptos" :key="c.orden"><td>{{ c.descripcion }}</td><td class="cfdi-mono">{{ c.claveProdServ }}</td><td>{{ c.claveUnidad }}</td><td>{{ c.cantidad }}</td><td class="numeric">{{ formatoDinero(c.valorUnitario, doc.moneda) }}</td><td class="numeric">{{ formatoDinero(c.descuento || 0, doc.moneda) }}</td><td class="numeric strong">{{ formatoDinero(c.importe, doc.moneda) }}</td></tr></tbody>
              </table>
            </div>
            <div v-else class="cfdi-empty-block"><FileText class="h-7 w-7" :stroke-width="1.5" /><strong>Conceptos vacío</strong><span>Esta factura todavía no tiene conceptos agregados.</span></div>
          </section>

          <section v-if="doc.tipo === 'P' && detail.pagos.length" class="cfdi-card">
            <header class="cfdi-card-header"><div><h2>Documentos relacionados <span class="cfdi-count">{{ detail.pagos.length }}</span></h2><p>Facturas aplicadas a este complemento de pago.</p></div></header>
            <div class="cfdi-concepts-wrap"><table class="cfdi-concepts"><thead><tr><th>CFDI</th><th>Parc.</th><th class="numeric">Saldo anterior</th><th class="numeric">Pagado</th><th class="numeric">Saldo insoluto</th></tr></thead><tbody><tr v-for="p in detail.pagos" :key="p.id"><td><NuxtLink :to="`/facturacion/${p.relacionado.id}`" class="cfdi-link">{{ p.relacionado.folio != null ? `#${p.relacionado.folio}` : '—' }} {{ p.relacionado.receptorNombre }}</NuxtLink><span class="cfdi-subline">{{ p.uuidFiscal || p.relacionado.uuidFiscal || '—' }}</span></td><td>{{ p.numParcialidad ?? '—' }}</td><td class="numeric">{{ formatoDinero(p.impSaldoAnt, p.monedaDr) }}</td><td class="numeric">{{ formatoDinero(p.impPagado, p.monedaDr) }}</td><td class="numeric">{{ formatoDinero(p.impSaldoIns, p.monedaDr) }}</td></tr></tbody></table></div>
          </section>

          <section v-if="detail.relaciones?.length" class="cfdi-card">
            <header class="cfdi-card-header"><div><h2>Registros relacionados</h2><p>Origen y documentos operativos vinculados a este CFDI.</p></div></header>
            <div class="cfdi-related-list"><div v-for="rel in detail.relaciones" :key="rel.id" class="cfdi-related-row"><div><strong>{{ rel.relationType === 'source' ? 'Origen del documento' : rel.relationType }}</strong><span>{{ rel.recordId }}</span></div><b v-if="rel.amount != null">{{ formatoDinero(rel.amount, rel.currency || doc.moneda) }}</b></div></div>
          </section>
        </main>

        <aside class="cfdi-side-column">
          <section class="cfdi-card cfdi-summary-card"><header class="cfdi-card-header"><div><h2>Resumen de importes</h2><p>Totales del comprobante.</p></div></header><dl class="cfdi-summary"><div><dt>Subtotal</dt><dd>{{ formatoDinero(doc.subtotal, doc.moneda) }}</dd></div><div><dt>Descuentos</dt><dd>−{{ formatoDinero(doc.descuento, doc.moneda) }}</dd></div><div v-for="(t, i) in (doc.impuestos?.traslados ?? [])" :key="`t${i}`"><dt>Impuestos trasladados<span v-if="t.tasaOCuota"> ({{ (Number(t.tasaOCuota) * 100).toFixed(0) }}%)</span></dt><dd>{{ formatoDinero(t.importe, doc.moneda) }}</dd></div><div v-for="(r, i) in (doc.impuestos?.retenciones ?? [])" :key="`r${i}`"><dt>Retenciones</dt><dd>−{{ formatoDinero(r.importe, doc.moneda) }}</dd></div><div class="cfdi-summary-total"><dt>Total {{ doc.moneda }}</dt><dd>{{ formatoDinero(doc.total, doc.moneda) }}</dd></div></dl></section>

          <section class="cfdi-card"><header class="cfdi-card-header"><div><h2>Historial fiscal</h2><p>Registro de intentos, acuses y envíos.</p></div></header><ol v-if="detail.events.length" class="cfdi-timeline"><li v-for="ev in [...detail.events].reverse()" :key="ev.id" :class="`timeline-${timelineTone(ev.tipo)}`"><span class="cfdi-timeline-dot" aria-hidden="true"></span><div><strong>{{ EVENTO_LABEL[ev.tipo] ?? ev.tipo }}</strong><p v-if="ev.detalle?.message" class="danger">{{ ev.detalle.message }}</p><p v-else-if="ev.detalle?.folio">{{ ev.detalle.folio }}{{ ev.detalle.serie ? ` · serie ${ev.detalle.serie}` : '' }}</p><p v-else-if="ev.detalle?.uuid" class="cfdi-mono">{{ ev.detalle.uuid }}</p><p v-else-if="ev.detalle?.para">Para {{ ev.detalle.para }}</p><small>{{ formatoFechaHora(ev.createdAt) }}</small></div></li></ol><p v-else class="cfdi-muted">Sin eventos todavía.</p></section>

          <section class="cfdi-card cfdi-quick-actions"><header class="cfdi-card-header"><div><h2>Acciones rápidas</h2></div></header><NuxtLink :to="`/facturacion-print/${doc.id}`" target="_blank"><Printer class="h-4 w-4" />PDF personalizado</NuxtLink><a v-if="estado === 'timbrada'" :href="`/api/facturacion/documents/${doc.id}/xml`"><Download class="h-4 w-4" />Descargar XML</a><a v-if="estado === 'timbrada'" :href="`/api/facturacion/documents/${doc.id}/pdf`"><Download class="h-4 w-4" />PDF oficial del PAC</a><button v-if="estado === 'timbrada'" type="button" @click="enviarPara = doc.receptorCorreo ?? ''; mostrarEnviar = true"><Mail class="h-4 w-4" />Enviar por correo</button><NuxtLink v-if="estado === 'timbrada' && doc.tipo === 'I'" :to="`/facturacion/nuevo?tipo=E&relacionado=${doc.id}`"><FileMinus class="h-4 w-4" />Crear nota de crédito</NuxtLink><button v-if="estado === 'timbrada'" type="button" class="danger" @click="mostrarCancelar = true"><Ban class="h-4 w-4" />Cancelar ante el SAT</button></section>
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

<style scoped>
.cfdi-detail-page {
  width: min(100%, 1280px);
  margin: 0 auto;
  padding: 8px 0 48px;
  color: var(--brand-text, #17324d);
}
.cfdi-back { display: inline-flex; align-items: center; gap: 6px; color: #527397; font-size: 13px; font-weight: 600; text-decoration: none; }
.cfdi-back:hover, .cfdi-link:hover { color: #009cc2; }
.cfdi-topline { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-top: 14px; }
.cfdi-breadcrumb { color: #7690ae; font-size: 12px; }
.cfdi-breadcrumb span { margin: 0 7px; color: #b5c2d0; }
.cfdi-breadcrumb strong { color: #17324d; }
.cfdi-environment { border-radius: 999px; background: #eef5f8; color: #527397; font-size: 11px; font-weight: 700; padding: 5px 10px; }
.cfdi-header-card, .cfdi-card { border: 1px solid #dce5ed; border-radius: 8px; background: #fff; box-shadow: 0 1px 2px rgba(23, 50, 77, .03); }
.cfdi-header-card { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 18px 24px; align-items: center; margin-top: 10px; padding: 20px 22px; }
.cfdi-header-main { display: flex; align-items: center; gap: 12px; min-width: 0; }
.cfdi-doc-icon { display: grid; place-items: center; width: 38px; height: 38px; flex: 0 0 auto; border-radius: 8px; background: #e9f6f9; color: #009dc4; }
.cfdi-title-block { min-width: 0; }
.cfdi-title-line { display: flex; align-items: center; flex-wrap: wrap; gap: 9px; }
.cfdi-title-line h1 { margin: 0; color: #17324d; font-size: 21px; line-height: 1.2; font-weight: 750; }
.cfdi-title-block p { margin: 5px 0 0; color: #527397; font-size: 13px; }
.cfdi-title-block p span, .cfdi-alert p span { margin: 0 5px; color: #a6b7c8; }
.cfdi-status { border-radius: 5px; padding: 4px 8px; font-size: 11px; font-weight: 700; }
.status-timbrada { color: #14744e; background: #e3f6eb; }
.status-borrador { color: #527397; background: #eef3f7; }
.status-error { color: #b9362f; background: #ffe4e1; }
.status-timbrando { color: #22698f; background: #e3f3fa; }
.status-cancelada { color: #6d7182; background: #edf0f3; }
.cfdi-total-block { text-align: right; white-space: nowrap; }
.cfdi-total-block span { display: block; color: #7690ae; font-size: 11px; }
.cfdi-total-block strong { display: block; margin-top: 3px; color: #17324d; font-size: 20px; font-weight: 750; }
.cfdi-action-row { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; grid-column: 1 / -1; border-top: 1px solid #edf1f5; padding-top: 16px; }
.cfdi-btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 34px; border-radius: 5px; padding: 7px 11px; font-size: 12px; font-weight: 700; text-decoration: none; cursor: pointer; transition: background .15s ease, border-color .15s ease; }
.cfdi-btn:disabled { cursor: not-allowed; opacity: .55; }
.cfdi-btn-outline { border: 1px solid #c8d7e4; background: #fff; color: #345879; }
.cfdi-btn-outline:hover { border-color: #8fb4ca; background: #f5f9fb; }
.cfdi-btn-primary { border: 1px solid #ff7258; background: #ff7258; color: white; }
.cfdi-btn-primary:hover { background: #ef624b; }
.cfdi-btn-danger { border: 1px solid #ec9d97; background: #fff; color: #c54841; }
.cfdi-btn-danger:hover { background: #fff2f0; }
.cfdi-alert { display: flex; align-items: flex-start; gap: 10px; margin-top: 14px; border-radius: 6px; padding: 13px 15px; font-size: 13px; }
.cfdi-alert-icon { display: grid; place-items: center; width: 20px; height: 20px; flex: 0 0 auto; border-radius: 50%; font-weight: 800; }
.cfdi-alert strong { display: block; font-size: 13px; }
.cfdi-alert p { margin: 3px 0 0; line-height: 1.45; }
.cfdi-alert small { display: block; margin-top: 4px; opacity: .8; }
.cfdi-alert-error { color: #a63a34; background: #fff0ee; border: 1px solid #f6cbc6; }
.cfdi-alert-error .cfdi-alert-icon { background: #e56a60; color: #fff; }
.cfdi-alert-info { color: #286e92; background: #edf8fc; border: 1px solid #c8e9f2; }
.cfdi-alert-info .cfdi-alert-icon { background: #a6dcec; color: #1f6f94; }
.cfdi-alert-success { color: #176e4c; background: #ecf9f1; border: 1px solid #c8ecd6; }
.cfdi-alert-success .cfdi-alert-icon { background: #32ae70; color: #fff; }
.cfdi-columns { display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: 18px; margin-top: 18px; align-items: start; }
.cfdi-main-column, .cfdi-side-column { display: grid; gap: 18px; min-width: 0; }
.cfdi-card { overflow: hidden; }
.cfdi-card-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; border-bottom: 1px solid #e7edf2; padding: 16px 18px 13px; }
.cfdi-card-header h2 { margin: 0; color: #17324d; font-size: 15px; font-weight: 750; }
.cfdi-card-header p { margin: 4px 0 0; color: #7690ae; font-size: 12px; line-height: 1.35; }
.cfdi-detail-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px 24px; padding: 17px 18px 19px; }
.cfdi-detail-grid dt { color: #7891ad; font-size: 11px; line-height: 1.2; }
.cfdi-detail-grid dd { margin: 5px 0 0; color: #17324d; font-size: 13px; line-height: 1.35; overflow-wrap: anywhere; }
.cfdi-mono { color: #527397 !important; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 11px !important; }
.cfdi-receptor-grid { padding-bottom: 15px; }
.cfdi-related-note { margin: 0 18px 16px; padding: 10px 12px; border-radius: 5px; background: #f5f8fa; color: #527397; font-size: 12px; }
.cfdi-related-note span { font-weight: 700; color: #345879; }
.cfdi-count { display: inline-grid; place-items: center; min-width: 21px; height: 21px; margin-left: 4px; border-radius: 999px; background: #eef5f8; color: #527397; font-size: 11px; vertical-align: 1px; }
.cfdi-concepts-wrap { overflow-x: auto; padding: 0 18px 17px; }
.cfdi-concepts { width: 100%; min-width: 680px; border-collapse: collapse; color: #34516d; font-size: 12px; }
.cfdi-concepts th { border-bottom: 1px solid #dfe8ef; padding: 12px 8px 10px; color: #7891ad; font-size: 10px; font-weight: 750; letter-spacing: .04em; text-align: left; text-transform: uppercase; white-space: nowrap; }
.cfdi-concepts td { border-bottom: 1px solid #edf1f4; padding: 12px 8px; vertical-align: top; }
.cfdi-concepts tr:last-child td { border-bottom: 0; }
.cfdi-concepts .numeric { text-align: right; white-space: nowrap; }
.cfdi-concepts .strong { color: #17324d; font-weight: 750; }
.cfdi-link { color: #008faf; font-weight: 700; text-decoration: none; }
.cfdi-subline { display: block; margin-top: 4px; color: #8ba0b5; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 10px; }
.cfdi-empty-block { display: grid; place-items: center; gap: 5px; min-height: 140px; padding: 18px; color: #829ab2; text-align: center; }
.cfdi-empty-block strong { color: #527397; font-size: 13px; }
.cfdi-empty-block span { font-size: 12px; }
.cfdi-related-list { padding: 8px 18px 14px; }
.cfdi-related-row { display: flex; align-items: center; justify-content: space-between; gap: 14px; border-bottom: 1px solid #edf1f4; padding: 11px 0; }
.cfdi-related-row:last-child { border-bottom: 0; }
.cfdi-related-row strong, .cfdi-related-row span { display: block; }
.cfdi-related-row strong { color: #345879; font-size: 12px; }
.cfdi-related-row span { margin-top: 3px; color: #8ba0b5; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 10px; }
.cfdi-related-row b { color: #17324d; font-size: 12px; white-space: nowrap; }
.cfdi-summary { padding: 10px 18px 17px; }
.cfdi-summary > div { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 6px 0; color: #527397; font-size: 12px; }
.cfdi-summary dd { margin: 0; color: #34516d; font-variant-numeric: tabular-nums; }
.cfdi-summary-total { margin-top: 7px; border-top: 1px solid #dfe8ef; padding-top: 13px !important; color: #17324d !important; font-size: 14px !important; font-weight: 750; }
.cfdi-summary-total dd { color: #17324d; font-size: 18px; font-weight: 800; }
.cfdi-timeline { margin: 0; padding: 15px 18px 18px 24px; list-style: none; }
.cfdi-timeline li { position: relative; display: flex; gap: 10px; border-left: 1px solid #d8e3eb; padding: 0 0 17px 15px; }
.cfdi-timeline li:last-child { border-left-color: transparent; padding-bottom: 0; }
.cfdi-timeline-dot { position: absolute; top: 2px; left: -5px; width: 9px; height: 9px; border: 2px solid #fff; border-radius: 50%; background: #dff2f7; box-shadow: 0 0 0 1px #09a0c0; }
.cfdi-timeline li.timeline-info .cfdi-timeline-dot { background: #dff2f7; box-shadow: 0 0 0 1px #09a0c0; }
.cfdi-timeline li.timeline-success .cfdi-timeline-dot { background: #dff4e7; box-shadow: 0 0 0 1px #35a76b; }
.cfdi-timeline li.timeline-warning .cfdi-timeline-dot { background: #fff0cc; box-shadow: 0 0 0 1px #d79626; }
.cfdi-timeline li.timeline-error .cfdi-timeline-dot { background: #ffe4e1; box-shadow: 0 0 0 1px #d45d55; }
.cfdi-timeline strong { display: block; color: #345879; font-size: 12px; }
.cfdi-timeline p { margin: 4px 0 0; color: #527397; font-size: 11px; line-height: 1.35; }
.cfdi-timeline p.danger { color: #bd4a42; }
.cfdi-timeline small { display: block; margin-top: 4px; color: #8ba0b5; font-size: 10px; }
.cfdi-muted { padding: 16px 18px 18px; color: #8ba0b5; font-size: 12px; }
.cfdi-quick-actions { padding-bottom: 8px; }
.cfdi-quick-actions .cfdi-card-header { border-bottom: 0; padding-bottom: 7px; }
.cfdi-quick-actions a, .cfdi-quick-actions button { display: flex; align-items: center; gap: 8px; width: calc(100% - 36px); margin: 0 18px 7px; border: 0; border-radius: 5px; background: #f5f8fa; padding: 9px 10px; color: #345879; font: inherit; font-size: 12px; text-align: left; text-decoration: none; cursor: pointer; }
.cfdi-quick-actions a:hover, .cfdi-quick-actions button:hover { background: #eaf5f8; color: #008faf; }
.cfdi-quick-actions .danger { color: #bd4a42; }
.cfdi-state-message { margin-top: 28px; color: #7891ad; font-size: 13px; }
.cfdi-error-state { display: grid; gap: 8px; max-width: 520px; margin-top: 24px; border: 1px solid #f6cbc6; border-radius: 8px; background: #fff5f3; padding: 18px; color: #a63a34; font-size: 13px; }
.cfdi-error-state strong { font-size: 15px; }
.cfdi-error-state .cfdi-btn { width: fit-content; margin-top: 4px; }
@media (max-width: 980px) {
  .cfdi-detail-page { padding-inline: 4px; }
  .cfdi-columns { grid-template-columns: 1fr; }
  .cfdi-side-column { grid-template-columns: repeat(2, minmax(0, 1fr)); align-items: start; }
  .cfdi-quick-actions { grid-column: 1 / -1; }
}
@media (max-width: 680px) {
  .cfdi-detail-page { padding-top: 4px; }
  .cfdi-topline { align-items: flex-start; flex-direction: column; gap: 8px; }
  .cfdi-header-card { grid-template-columns: 1fr; padding: 16px; }
  .cfdi-total-block { text-align: left; }
  .cfdi-action-row { justify-content: flex-start; }
  .cfdi-btn { flex: 0 0 auto; }
  .cfdi-detail-grid { grid-template-columns: 1fr; gap: 13px; padding-inline: 15px; }
  .cfdi-card-header { padding-inline: 15px; }
  .cfdi-concepts-wrap { padding-inline: 10px; }
  .cfdi-side-column { grid-template-columns: 1fr; }
  .cfdi-quick-actions { grid-column: auto; }
  .cfdi-alert { padding-inline: 12px; }
}
</style>
