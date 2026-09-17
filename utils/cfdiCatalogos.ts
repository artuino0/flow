// Catálogos SAT para CFDI 4.0 (dominio fiscal fijo, DOCS/HU_Timbrado_CFDI_PAC.md).
// Viven en utils/ (raíz) a propósito: son isomórficos — la UI los usa para los
// selectores y el servidor para validar. Estáticos por decisión de la HU: el
// SAT publica actualizaciones pocas veces al año; se refrescan con release y
// la versión queda documentada aquí. Fuente: catálogos públicos del SAT
// (c_UsoCFDI, c_FormaPago, c_RegimenFiscal, c_TipoRelacion, c_MotivosCancelacion).

export interface CatalogoOpcion {
  value: string
  label: string
}

export const RFC_REGEX_SRC = '^[A-ZÑ&]{3,4}\\d{6}[A-Z0-9]{3}$'
export const CP_REGEX_SRC = '^\\d{5}$'

export const TIPOS_COMPROBANTE: CatalogoOpcion[] = [
  { value: 'I', label: 'I · Ingreso (factura)' },
  { value: 'E', label: 'E · Egreso (nota de crédito)' },
  { value: 'P', label: 'P · Pago (complemento)' }
]

export const USOS_CFDI: CatalogoOpcion[] = [
  { value: 'G01', label: 'G01 · Adquisición de mercancías' },
  { value: 'G02', label: 'G02 · Devoluciones, descuentos o bonificaciones' },
  { value: 'G03', label: 'G03 · Gastos en general' },
  { value: 'I01', label: 'I01 · Construcciones' },
  { value: 'I02', label: 'I02 · Mobiliario y equipo de oficina' },
  { value: 'I03', label: 'I03 · Equipo de transporte' },
  { value: 'I04', label: 'I04 · Equipo de cómputo y accesorios' },
  { value: 'I05', label: 'I05 · Dados, troqueles, moldes, matrices y herramental' },
  { value: 'I06', label: 'I06 · Comunicaciones telefónicas' },
  { value: 'I07', label: 'I07 · Servicios de comunicación' },
  { value: 'P01', label: 'P01 · Por definir' },
  { value: 'C01', label: 'C01 · Nómina' },
  { value: 'S01', label: 'S01 · Sin efectos fiscales' }
]

export const FORMAS_PAGO: CatalogoOpcion[] = [
  { value: '01', label: '01 · Efectivo' },
  { value: '02', label: '02 · Cheque nominativo' },
  { value: '03', label: '03 · Transferencia electrónica de fondos' },
  { value: '04', label: '04 · Tarjeta de crédito' },
  { value: '05', label: '05 · Monedero electrónico' },
  { value: '06', label: '06 · Dinero electrónico' },
  { value: '08', label: '08 · Vales de despensa' },
  { value: '12', label: '12 · Dación en pago' },
  { value: '13', label: '13 · Pago por subrogación' },
  { value: '14', label: '14 · Pago por consignación' },
  { value: '15', label: '15 · Condonación' },
  { value: '17', label: '17 · Compensación' },
  { value: '23', label: '23 · Novación' },
  { value: '24', label: '24 · Confusión' },
  { value: '25', label: '25 · Remisión de deuda' },
  { value: '26', label: '26 · Prescripción' },
  { value: '27', label: '27 · A satisfacción' },
  { value: '28', label: '28 · Tarjeta de débito' },
  { value: '29', label: '29 · Tarjeta de servicios' },
  { value: '30', label: '30 · Aplicación de anticipos' },
  { value: '31', label: '31 · Intermediario pagos' },
  { value: '99', label: '99 · Por definir' }
]

export const METODOS_PAGO: CatalogoOpcion[] = [
  { value: 'PUE', label: 'PUE · Pago en una sola exhibición' },
  { value: 'PPD', label: 'PPD · Pago en parcialidades o diferido' }
]

export const EXPORTACION: CatalogoOpcion[] = [
  { value: '01', label: '01 · No aplica' },
  { value: '02', label: '02 · Definitiva' },
  { value: '03', label: '03 · Temporal' }
]

// Subconjunto operativo de c_RegimenFiscal (los de alta rotación en PyMEs).
// Si un cliente necesita uno fuera de esta lista, se agrega con release.
export const REGIMENES_FISCALES: CatalogoOpcion[] = [
  { value: '601', label: '601 · General de Ley Personas Morales' },
  { value: '603', label: '603 · Personas Morales con Fines no Lucrativos' },
  { value: '605', label: '605 · Sueldos y Salarios e Ingresos Asimilados' },
  { value: '606', label: '606 · Arrendamiento' },
  { value: '607', label: '607 · Enajenación o Adquisición de Bienes' },
  { value: '608', label: '608 · Demás ingresos' },
  { value: '609', label: '609 · Residentes en el Extranjero sin Establecimiento Permanente' },
  { value: '610', label: '610 · Ingresos por Dividendos' },
  { value: '611', label: '611 · Ingresos por Intereses' },
  { value: '612', label: '612 · Actividades Empresariales y Servicios Profesionales' },
  { value: '614', label: '614 · Ingresos por premios' },
  { value: '616', label: '616 · Régimen de Incorporación Fiscal (RIF)' },
  { value: '620', label: '620 · Sociedades Cooperativas de Producción' },
  { value: '621', label: '621 · Incorporación a la Seguridad Social' },
  { value: '622', label: '622 · Actividades Agrícolas, Ganaderas, Silvícolas y Pesqueras' },
  { value: '623', label: '623 · Opcional para Grupos de Sociedades' },
  { value: '624', label: '624 · Coordinados' },
  { value: '625', label: '625 · Hidrocarburos' },
  { value: '626', label: '626 · Régimen Simplificado de Confianza (RESICO)' }
]

export const TIPOS_RELACION: CatalogoOpcion[] = [
  { value: '01', label: '01 · Nota de crédito de los documentos relacionados' },
  { value: '02', label: '02 · Nota de débito de los documentos relacionados' },
  { value: '03', label: '03 · Devolución de mercancía sobre facturas previas' },
  { value: '04', label: '04 · Sustitución de los CFDI previos' },
  { value: '05', label: '05 · Traslados de mercancías facturados previamente' },
  { value: '06', label: '06 · Factura por traslados previos' },
  { value: '07', label: '07 · CFDI por aplicación de anticipo' },
  { value: '08', label: '08 · Factura por pagos en parcialidades' },
  { value: '09', label: '09 · Factura por pagos diferidos' }
]

// OJO (regla SAT): el motivo 01 ("emitido con errores CON relación") es el que
// exige FolioSustitucion (el UUID del CFDI que lo reemplaza); el 02 es "con
// errores SIN relación" y no lleva sustituto. Validado en cfdi/timbrado.ts.
export const MOTIVOS_CANCELACION: CatalogoOpcion[] = [
  { value: '01', label: '01 · Emitido con errores con relación (requiere sustituto)' },
  { value: '02', label: '02 · Emitido con errores sin relación' },
  { value: '03', label: '03 · No se llevó a cabo la operación' },
  { value: '04', label: '04 · Operación nominativa relacionada en factura global' }
]

// Presets de traslado por concepto para la UI (el servidor acepta cualquier
// clave 002/003 con tipoFactor/tasa libres — los presets son conveniencia).
export interface ImpuestoPreset {
  id: string
  label: string
  clave: '002' | '003'
  tipoFactor: 'Tasa' | 'Cuota' | 'Exento'
  tasa: number
}

export const IMPUESTOS_PRESET: ImpuestoPreset[] = [
  { id: 'iva16', label: 'IVA 16%', clave: '002', tipoFactor: 'Tasa', tasa: 0.16 },
  { id: 'iva8', label: 'IVA 8%', clave: '002', tipoFactor: 'Tasa', tasa: 0.08 },
  { id: 'iva0', label: 'IVA 0%', clave: '002', tipoFactor: 'Tasa', tasa: 0 },
  { id: 'iva-exento', label: 'IVA exento', clave: '002', tipoFactor: 'Exento', tasa: 0 },
  { id: 'sin-impuesto', label: 'Sin impuesto', clave: '002', tipoFactor: 'Exento', tasa: 0 },
  { id: 'ieps-custom', label: 'IEPS (tasa manual)', clave: '003', tipoFactor: 'Tasa', tasa: 0.25 }
]

export function catalogoLabel(catalogo: CatalogoOpcion[], value: string | null | undefined): string {
  if (!value) return '—'
  return catalogo.find((o) => o.value === value)?.label ?? value
}

// Etiquetas + clases de badge por estado del documento (tokens del sistema
// visual: success-bg/success-text, error-bg/error-text, blue-bg, brand-bg).
export const ESTADOS_CFDI: Record<string, { label: string; badge: string }> = {
  borrador: { label: 'Borrador', badge: 'bg-brand-bg text-brand-text-secondary' },
  timbrando: { label: 'Timbrando…', badge: 'bg-brand-blue-bg text-brand-blue' },
  timbrada: { label: 'Timbrada', badge: 'bg-brand-success-bg text-brand-success-text' },
  error: { label: 'Error de timbrado', badge: 'bg-brand-error-bg text-brand-error-text' },
  cancelada: { label: 'Cancelada', badge: 'bg-brand-error-bg text-brand-error-text' }
}

export const TIPO_CFDI_LABEL: Record<string, string> = { I: 'Factura', E: 'Nota de crédito', P: 'Complemento de pago' }

export function enCatalogo(catalogo: CatalogoOpcion[], value: string | null | undefined): boolean {
  return Boolean(value && catalogo.some((o) => o.value === value))
}

// Formateadores compartidos (mismo criterio que los reportes imprimibles:
// números en formato mexicano).
export function formatoDinero(valor: number | string | null | undefined, moneda = 'MXN'): string {
  const n = typeof valor === 'string' ? Number(valor) : valor
  if (n == null || Number.isNaN(n)) return '—'
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: moneda, minimumFractionDigits: 2 }).format(n)
}

export function formatoFecha(valor: string | Date | null | undefined): string {
  if (!valor) return '—'
  return new Date(valor).toLocaleDateString('es-MX', { dateStyle: 'medium' })
}

export function formatoFechaHora(valor: string | Date | null | undefined): string {
  if (!valor) return '—'
  return new Date(valor).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })
}
