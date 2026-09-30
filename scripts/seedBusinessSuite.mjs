/**
 * Paquete operativo oficial para Flow.
 *
 * Crea, sin duplicar ni borrar configuraciones existentes:
 * - Inventarios
 * - Cuentas por pagar
 * - Cuentas por cobrar
 * - Facturación (preparada para integrar un PAC)
 * - Catálogos compartidos, navegación, permisos y reportes iniciales
 *
 * Uso:
 *   node scripts/seedBusinessSuite.mjs [tenant-id-o-slug]
 *
 * Si no se indica organización, se aplica a grupo-agricola-salmantino.
 */
import 'dotenv/config'
import postgres from 'postgres'
import { randomUUID } from 'node:crypto'

const connectionString = process.env.APP_DATABASE_URL || process.env.DATABASE_URL || 'postgresql://erp_app:changeme_app@localhost:5433/erp_dinamico'
const tenantRef = process.argv[2] || 'grupo-agricola-salmantino'
const db = postgres(connectionString)

const option = (value, label, color) => ({ value, label, ...(color ? { color } : {}) })
const text = (name, label, required = false, maxLength = 160) => ({ name, label, dataType: 'text', isRequired: required, validationRules: { maxLength } })
const number = (name, label, required = false, rules = { min: 0 }) => ({ name, label, dataType: 'number', isRequired: required, validationRules: rules })
const money = (name, label, required = false, rules = {}) => ({ name, label, dataType: 'currency', isRequired: required, validationRules: { currency: 'tenant', decimals: 2, allowNegative: false, min: 0, ...rules } })
const date = (name, label, required = false) => ({ name, label, dataType: 'date', isRequired: required, validationRules: {} })
const bool = (name, label, required = false) => ({ name, label, dataType: 'boolean', isRequired: required, validationRules: {} })
const relation = (name, label, entity, required = false) => ({ name, label, dataType: 'relation', isRequired: required, validationRules: { relationEntity: entity } })
const select = (name, label, options, required = false) => ({ name, label, dataType: 'select', isRequired: required, validationRules: { options } })
const file = (name, label) => ({ name, label, dataType: 'file', isRequired: false, validationRules: {} })
const folio = (name = 'folio', label = 'Folio', digits = 6) => ({ name, label, dataType: 'incremental', isRequired: false, validationRules: { digits } })

// Dominio fiscal fijo (DOCS/HU_Timbrado_CFDI_PAC.md, decisión 2026-09-14 del
// usuario: "la facturación es fija"): series_fiscales, facturas,
// partidas_factura, notas_credito y complementos_pago ya NO son módulos
// dinámicos — viven en cfdi_series/cfdi_documents/cfdi_conceptos/
// cfdi_payment_docs (migración 0049) con su propia UI en /facturacion. Este
// seed ya no los crea; los tenants de prueba sembrados antes se limpian con
// scripts/removeFiscalDynamicModules.mjs.

const active = [option('activo', 'Activo', 'success'), option('inactivo', 'Inactivo', 'neutral')]
const currencies = [option('MXN', 'MXN · Peso mexicano'), option('USD', 'USD · Dólar estadounidense'), option('EUR', 'EUR · Euro')]
const documentStatus = [option('borrador', 'Borrador', 'neutral'), option('vigente', 'Vigente', 'blue'), option('pagado', 'Pagado', 'success'), option('vencido', 'Vencido', 'error'), option('cancelado', 'Cancelado', 'error')]
const paymentStatus = [option('borrador', 'Borrador', 'neutral'), option('aplicado', 'Aplicado', 'success'), option('cancelado', 'Cancelado', 'error')]

const catalogs = [
  { slug: 'unidades_medida', name: 'Unidades de medida', singularName: 'Unidad de medida', icon: 'Ruler', labelField: 'nombre', fields: [text('clave', 'Clave', true, 12), text('nombre', 'Nombre', true), text('simbolo', 'Símbolo', true, 12), select('estado', 'Estado', active, true)] },
  { slug: 'almacenes', name: 'Almacenes', singularName: 'Almacén', icon: 'Warehouse', labelField: 'nombre', fields: [text('clave', 'Clave', true, 20), text('nombre', 'Nombre', true), text('direccion', 'Dirección', false, 300), text('responsable', 'Responsable'), select('estado', 'Estado', active, true)] },
  { slug: 'ubicaciones_almacen', name: 'Ubicaciones de almacén', singularName: 'Ubicación de almacén', icon: 'MapPin', labelField: 'nombre', fields: [text('clave', 'Clave', true, 30), text('nombre', 'Nombre', true), relation('almacen', 'Almacén', 'almacenes', true), text('zona', 'Zona'), text('pasillo', 'Pasillo', false, 30), text('rack', 'Rack', false, 30), select('estado', 'Estado', active, true)] },
  { slug: 'productos', name: 'Productos', singularName: 'Producto', icon: 'Package', labelField: 'nombre', fields: [bool('activo', 'Activo'), text('sku', 'Código', true, 40), text('nombre', 'Nombre de producto', true), relation('cultivo', 'Cultivo', 'cultivos'), text('nombre_extranjero', 'Nombre en el extranjero (inglés)', false, 180), bool('mercado_extranjero', 'Mercado extranjero'), text('envase', 'Envase', false, 80), text('tamano_envase', 'Tamaño de envase', false, 80), number('peso_unitario', 'Peso unitario', false, { min: 0 }), number('peso_bruto', 'Peso bruto', false, { min: 0 }), number('bultos_pallet', 'Bultos por pallet', false, { min: 0, integer: true }), select('calidad', 'Calidad', [option('primera', 'Primera', 'success'), option('segunda', 'Segunda', 'warning'), option('industrial', 'Industrial', 'blue'), option('sin_clasificar', 'Sin clasificar', 'neutral')]), text('descripcion', 'Descripción', false, 500), relation('unidad', 'Unidad de medida', 'unidades_medida', true), text('categoria', 'Categoría'), bool('controla_lotes', 'Controla lotes'), bool('controla_caducidad', 'Controla caducidad'), bool('pti_directo', 'PTI directo'), money('costo_estandar', 'Costo estándar'), text('clave_prod_serv', 'ClaveProdServ (SAT)', false, 8), select('estado', 'Estado', active, true)] },
  { slug: 'proveedores', name: 'Proveedores', singularName: 'Proveedor', icon: 'Building2', labelField: 'razon_social', fields: [text('razon_social', 'Razón social', true), text('nombre_comercial', 'Nombre comercial'), text('rfc', 'RFC', false, 20), text('correo', 'Correo electrónico'), text('telefono', 'Teléfono', false, 30), text('direccion_fiscal', 'Dirección fiscal', false, 400), relation('condicion_pago', 'Condición de pago', 'condiciones_pago'), select('moneda', 'Moneda habitual', currencies), select('estado', 'Estado', active, true)] },
  { slug: 'condiciones_pago', name: 'Condiciones de pago', singularName: 'Condición de pago', icon: 'CalendarClock', labelField: 'nombre', fields: [text('clave', 'Clave', true, 20), text('nombre', 'Nombre', true), number('dias_credito', 'Días de crédito', true, { min: 0, integer: true }), select('estado', 'Estado', active, true)] },
  { slug: 'impuestos', name: 'Impuestos', singularName: 'Impuesto', icon: 'BadgePercent', labelField: 'nombre', fields: [text('clave', 'Clave', true, 20), text('nombre', 'Nombre', true), select('tipo', 'Tipo', [option('traslado', 'Traslado'), option('retencion', 'Retención')], true), number('tasa', 'Tasa (%)', true, { min: 0, max: 100 }), bool('exento', 'Exento'), select('estado', 'Estado', active, true)] },
  { slug: 'metodos_pago', name: 'Métodos de pago', singularName: 'Método de pago', icon: 'WalletCards', labelField: 'nombre', fields: [text('clave', 'Clave', true, 10), text('nombre', 'Nombre', true), select('estado', 'Estado', active, true)] },
  { slug: 'cuentas_bancarias', name: 'Cuentas bancarias', singularName: 'Cuenta bancaria', icon: 'Landmark', labelField: 'nombre', fields: [text('nombre', 'Nombre de la cuenta', true), text('banco', 'Banco', true), text('numero_cuenta', 'Número de cuenta', false, 30), text('clabe', 'CLABE', false, 18), select('moneda', 'Moneda', currencies, true), select('estado', 'Estado', active, true)] }
].map(entity => ({ ...entity, moduleKind: 'dimension' }))

const facts = [
  { slug: 'movimientos_inventario', name: 'Movimientos de inventario', singularName: 'Movimiento de inventario', icon: 'ArrowLeftRight', labelField: 'folio', area: 'Inventarios', fields: [folio(), date('fecha', 'Fecha', true), select('tipo', 'Tipo de movimiento', [option('entrada', 'Entrada', 'success'), option('salida', 'Salida', 'error'), option('transferencia', 'Transferencia', 'blue'), option('ajuste_entrada', 'Ajuste de entrada', 'warning'), option('ajuste_salida', 'Ajuste de salida', 'warning')], true), relation('producto', 'Producto', 'productos', true), text('lote', 'Lote', false, 60), date('caducidad', 'Fecha de caducidad'), relation('almacen_origen', 'Almacén origen', 'almacenes'), relation('ubicacion_origen', 'Ubicación origen', 'ubicaciones_almacen'), relation('almacen_destino', 'Almacén destino', 'almacenes'), relation('ubicacion_destino', 'Ubicación destino', 'ubicaciones_almacen'), number('cantidad', 'Cantidad', true), relation('unidad', 'Unidad de medida', 'unidades_medida', true), money('costo_unitario', 'Costo unitario'), relation('recepcion', 'Recepción', 'recepciones'), relation('embarque', 'Embarque', 'embarques'), select('estado', 'Estado', [option('borrador', 'Borrador', 'neutral'), option('confirmado', 'Confirmado', 'success'), option('cancelado', 'Cancelado', 'error')], true), text('observaciones', 'Observaciones', false, 500)] },
  { slug: 'conteos_inventario', name: 'Conteos de inventario', singularName: 'Conteo de inventario', icon: 'ClipboardCheck', labelField: 'folio', area: 'Inventarios', fields: [folio(), date('fecha', 'Fecha', true), relation('almacen', 'Almacén', 'almacenes', true), text('responsable', 'Responsable', true), select('estado', 'Estado', [option('borrador', 'Borrador'), option('en_conteo', 'En conteo', 'warning'), option('cerrado', 'Cerrado', 'success'), option('cancelado', 'Cancelado', 'error')], true), text('observaciones', 'Observaciones', false, 500)] },
  { slug: 'conteo_partidas', name: 'Partidas de conteo', singularName: 'Partida de conteo', icon: 'ListChecks', area: 'Inventarios', fields: [relation('conteo', 'Conteo', 'conteos_inventario', true), relation('producto', 'Producto', 'productos', true), relation('ubicacion', 'Ubicación', 'ubicaciones_almacen'), text('lote', 'Lote', false, 60), number('existencia_sistema', 'Existencia en sistema', true), number('cantidad_contada', 'Cantidad contada', true), number('diferencia', 'Diferencia', true, {}), text('observacion', 'Observación', false, 300)] },

  { slug: 'cuentas_por_pagar', name: 'Cuentas por pagar', singularName: 'Cuenta por pagar', icon: 'ReceiptText', labelField: 'folio', area: 'Cuentas por pagar', fields: [folio(), relation('proveedor', 'Proveedor', 'proveedores', true), text('numero_documento', 'Número de documento', true, 50), select('tipo_documento', 'Tipo de documento', [option('factura', 'Factura'), option('nota_cargo', 'Nota de cargo'), option('otro', 'Otro')], true), date('fecha_emision', 'Fecha de emisión', true), date('fecha_vencimiento', 'Fecha de vencimiento', true), relation('condicion_pago', 'Condición de pago', 'condiciones_pago'), select('moneda', 'Moneda', currencies, true), money('subtotal', 'Subtotal', true), money('impuestos', 'Impuestos', true), money('total', 'Total', true), money('saldo', 'Saldo pendiente', true), relation('recepcion', 'Recepción relacionada', 'recepciones'), select('estado', 'Estado', documentStatus, true), file('documento', 'Documento adjunto'), text('observaciones', 'Observaciones', false, 500)] },
  { slug: 'pagos_proveedor', name: 'Pagos a proveedores', singularName: 'Pago a proveedor', icon: 'CircleDollarSign', labelField: 'folio', area: 'Cuentas por pagar', fields: [folio(), date('fecha', 'Fecha de pago', true), relation('proveedor', 'Proveedor', 'proveedores', true), relation('cuenta_bancaria', 'Cuenta bancaria', 'cuentas_bancarias', true), relation('metodo_pago', 'Método de pago', 'metodos_pago', true), text('referencia', 'Referencia', false, 80), select('moneda', 'Moneda', currencies, true), money('monto', 'Monto', true), select('estado', 'Estado', paymentStatus, true), file('comprobante', 'Comprobante'), text('observaciones', 'Observaciones', false, 500)] },
  { slug: 'aplicaciones_pago_proveedor', name: 'Aplicaciones de pago a proveedor', singularName: 'Aplicación de pago a proveedor', icon: 'Link2', area: 'Cuentas por pagar', fields: [relation('pago', 'Pago', 'pagos_proveedor', true), relation('cuenta_por_pagar', 'Cuenta por pagar', 'cuentas_por_pagar', true), date('fecha', 'Fecha', true), money('monto', 'Monto aplicado', true)] },

  { slug: 'cuentas_por_cobrar', name: 'Cuentas por cobrar', singularName: 'Cuenta por cobrar', icon: 'HandCoins', labelField: 'folio', area: 'Cuentas por cobrar', fields: [folio(), relation('cliente', 'Cliente', 'clientes', true), text('numero_documento', 'Número de documento', true, 50), select('tipo_documento', 'Tipo de documento', [option('factura', 'Factura'), option('nota_cargo', 'Nota de cargo'), option('otro', 'Otro')], true), date('fecha_emision', 'Fecha de emisión', true), date('fecha_vencimiento', 'Fecha de vencimiento', true), relation('condicion_pago', 'Condición de pago', 'condiciones_pago'), select('moneda', 'Moneda', currencies, true), money('subtotal', 'Subtotal', true), money('impuestos', 'Impuestos', true), money('total', 'Total', true), money('saldo', 'Saldo pendiente', true), relation('embarque', 'Embarque relacionado', 'embarques'), select('estado', 'Estado', documentStatus, true), text('observaciones', 'Observaciones', false, 500)] },
  { slug: 'cobros_cliente', name: 'Cobros de clientes', singularName: 'Cobro de cliente', icon: 'BadgeDollarSign', labelField: 'folio', area: 'Cuentas por cobrar', fields: [folio(), date('fecha', 'Fecha de cobro', true), relation('cliente', 'Cliente', 'clientes', true), relation('cuenta_bancaria', 'Cuenta bancaria', 'cuentas_bancarias', true), relation('metodo_pago', 'Método de pago', 'metodos_pago', true), text('referencia', 'Referencia', false, 80), select('moneda', 'Moneda', currencies, true), money('monto', 'Monto', true), select('estado', 'Estado', paymentStatus, true), file('comprobante', 'Comprobante'), text('observaciones', 'Observaciones', false, 500)] },
  { slug: 'aplicaciones_cobro', name: 'Aplicaciones de cobro', singularName: 'Aplicación de cobro', icon: 'Link2', area: 'Cuentas por cobrar', fields: [relation('cobro', 'Cobro', 'cobros_cliente', true), relation('cuenta_por_cobrar', 'Cuenta por cobrar', 'cuentas_por_cobrar', true), date('fecha', 'Fecha', true), money('monto', 'Monto aplicado', true)] }
].map(entity => ({ ...entity, moduleKind: 'hecho' }))

const extensions = {
  clientes: [text('razon_social', 'Razón social'), text('rfc', 'RFC', false, 20), text('regimen_fiscal', 'Régimen fiscal'), text('codigo_postal_fiscal', 'Código postal fiscal', false, 10), text('uso_cfdi', 'Uso de CFDI', false, 10), relation('condicion_pago', 'Condición de pago', 'condiciones_pago')]
}

const starterData = {
  unidades_medida: [
    { clave: 'KGM', nombre: 'Kilogramo', simbolo: 'kg', estado: 'activo' }, { clave: 'H87', nombre: 'Pieza', simbolo: 'pza', estado: 'activo' },
    { clave: 'XBX', nombre: 'Caja', simbolo: 'caja', estado: 'activo' }, { clave: 'XPK', nombre: 'Paquete', simbolo: 'paq', estado: 'activo' }
  ],
  condiciones_pago: [{ clave: 'CONTADO', nombre: 'Contado', dias_credito: 0, estado: 'activo' }, { clave: 'CRED15', nombre: 'Crédito 15 días', dias_credito: 15, estado: 'activo' }, { clave: 'CRED30', nombre: 'Crédito 30 días', dias_credito: 30, estado: 'activo' }],
  impuestos: [{ clave: 'IVA16', nombre: 'IVA 16%', tipo: 'traslado', tasa: 16, exento: false, estado: 'activo' }, { clave: 'IVA0', nombre: 'IVA 0%', tipo: 'traslado', tasa: 0, exento: false, estado: 'activo' }, { clave: 'EXENTO', nombre: 'Exento de IVA', tipo: 'traslado', tasa: 0, exento: true, estado: 'activo' }],
  metodos_pago: [{ clave: '03', nombre: 'Transferencia electrónica', estado: 'activo' }, { clave: '01', nombre: 'Efectivo', estado: 'activo' }, { clave: '04', nombre: 'Tarjeta de crédito', estado: 'activo' }],
  almacenes: [{ clave: 'PT', nombre: 'Producto terminado', estado: 'activo' }, { clave: 'MP', nombre: 'Materia prima', estado: 'activo' }]
}

const reportDefs = [
  { title: 'Kardex de inventario', baseEntity: 'movimientos_inventario', layout: { paper: 'letter', orientation: 'landscape', density: 'compact' }, columns: [['folio', 'Folio'], ['fecha', 'Fecha'], ['tipo', 'Movimiento'], ['producto', 'Producto'], ['lote', 'Lote'], ['cantidad', 'Cantidad'], ['costo_unitario', 'Costo unitario'], ['estado', 'Estado']] },
  { title: 'Estado de cuentas por pagar', baseEntity: 'cuentas_por_pagar', layout: { paper: 'letter', orientation: 'landscape', density: 'compact' }, columns: [['folio', 'Folio'], ['proveedor', 'Proveedor'], ['fecha_emision', 'Emisión'], ['fecha_vencimiento', 'Vencimiento'], ['total', 'Total'], ['saldo', 'Saldo'], ['estado', 'Estado']] },
  { title: 'Estado de cuentas por cobrar', baseEntity: 'cuentas_por_cobrar', layout: { paper: 'letter', orientation: 'landscape', density: 'compact' }, columns: [['folio', 'Folio'], ['cliente', 'Cliente'], ['fecha_emision', 'Emisión'], ['fecha_vencimiento', 'Vencimiento'], ['total', 'Total'], ['saldo', 'Saldo'], ['estado', 'Estado']] }
]

function baseLayout(fields, slug) {
  if (slug === 'productos') {
    return {
      columns: ['activo', 'sku', 'nombre', 'cultivo', 'nombre_extranjero', 'mercado_extranjero', 'envase', 'tamano_envase', 'peso_unitario', 'peso_bruto', 'bultos_pallet', 'calidad', 'pti_directo'].map(name => ({ name, visible: true })).concat(['descripcion', 'unidad', 'categoria', 'controla_lotes', 'controla_caducidad', 'costo_estandar', 'clave_prod_serv', 'estado'].map(name => ({ name, visible: false }))),
      filterFields: ['activo', 'cultivo', 'mercado_extranjero', 'calidad'],
      defaultSort: { field: 'sku', dir: 'asc' }
    }
  }
  return {
    columns: fields.slice(0, 8).map(field => ({ name: field.name, visible: true })),
    filterFields: fields.filter(field => ['select', 'relation', 'boolean', 'date'].includes(field.dataType)).slice(0, 6).map(field => field.name),
    defaultSort: fields.some(field => field.name === 'fecha') ? { field: 'fecha', dir: 'desc' } : null
  }
}

function detailLayout(fields, slug) {
  if (slug === 'productos') {
    const visible = ['activo', 'sku', 'nombre', 'cultivo', 'nombre_extranjero', 'mercado_extranjero', 'envase', 'tamano_envase', 'peso_unitario', 'peso_bruto', 'bultos_pallet', 'calidad', 'pti_directo']
    return { properties: fields.map(field => ({ name: field.name, visible: visible.includes(field.name) })), relations: [], showActivity: true }
  }
  return { properties: fields.map(field => ({ name: field.name, visible: true })), relations: [], showActivity: true }
}

async function upsertEntity(tx, tenantId, def, adminRoleId) {
  await tx`
    insert into entities (tenant_id, name, slug, icon, module_kind, label_field, singular_name)
    values (${tenantId}, ${def.name}, ${def.slug}, ${def.icon}, ${def.moduleKind}, ${def.labelField || null}, ${def.singularName || null})
    on conflict (tenant_id, slug) do nothing
  `
  const [entity] = await tx`select id, list_layout, detail_layout from entities where tenant_id = ${tenantId} and slug = ${def.slug}`
  let added = 0
  for (let i = 0; i < def.fields.length; i++) {
    const field = def.fields[i]
    const result = await tx`
      insert into entity_fields (entity_id, name, label, data_type, validation_rules, is_required, sort_order)
      values (${entity.id}, ${field.name}, ${field.label}, ${field.dataType}, ${tx.json(field.validationRules)}, ${field.isRequired}, ${i})
      on conflict (entity_id, name) do nothing returning id
    `
    added += result.length
  }
  await tx`
    update entities set
      list_layout = coalesce(list_layout, ${tx.json(baseLayout(def.fields, def.slug))}),
      detail_layout = coalesce(detail_layout, ${tx.json(detailLayout(def.fields, def.slug))}),
      updated_at = now()
    where id = ${entity.id}
  `
  if (adminRoleId) {
    await tx`
      insert into role_entity_permissions (role_id, entity_id, can_read, can_create, can_update, can_delete, show_in_menu)
      values (${adminRoleId}, ${entity.id}, true, true, true, true, true)
      on conflict (role_id, entity_id) do update set can_read=true, can_create=true, can_update=true, can_delete=true
    `
  }
  return { id: entity.id, added }
}

function mergeNavigation(layout, entityIds) {
  const groups = Array.isArray(layout?.groups) ? structuredClone(layout.groups) : []
  const managed = new Set(Object.values(entityIds))
  for (const group of groups) group.entityIds = (group.entityIds || []).filter(id => !managed.has(id))

  const ensure = (name, icon, parentId = null) => {
    let group = groups.find(item => item.name === name && (item.parentId || null) === parentId)
    if (!group) { group = { id: randomUUID(), name, icon, parentId, entityIds: [] }; groups.push(group) }
    else group.icon ||= icon
    return group
  }
  const inventory = ensure('Inventarios', 'Boxes')
  const finance = ensure('Finanzas', 'Landmark')
  const payable = ensure('Cuentas por pagar', 'ReceiptText', finance.id)
  const receivable = ensure('Cuentas por cobrar', 'HandCoins', finance.id)
  // (Fase H del dominio fiscal fijo: ya no se crea el grupo "Facturación" de
  // módulos dinámicos — la entrada de Facturación es fija en AppNav, solo
  // tenants MX, y apunta a /facturacion sobre las tablas cfdi_*.)
  inventory.entityIds = facts.filter(x => x.area === 'Inventarios').map(x => entityIds[x.slug])
  payable.entityIds = facts.filter(x => x.area === 'Cuentas por pagar').map(x => entityIds[x.slug])
  receivable.entityIds = facts.filter(x => x.area === 'Cuentas por cobrar').map(x => entityIds[x.slug])
  finance.entityIds = []
  return { groups }
}

try {
  await db.begin(async tx => {
    const [tenant] = await tx`select id, name, slug, navigation_layout from tenants where id::text = ${tenantRef} or slug = ${tenantRef} for update`
    if (!tenant) throw new Error(`No existe la organización "${tenantRef}"`)
    await tx`select set_config('app.tenant_id', ${tenant.id}, true), set_config('app.person_id', '00000000-0000-0000-0000-000000000000', true), set_config('app.record_system', 'on', true)`
    const [adminRole] = await tx`select id from roles where tenant_id=${tenant.id} and is_system=true order by created_at limit 1`
    const [adminUser] = await tx`select id from users where tenant_id=${tenant.id} and role_id=${adminRole?.id || null} and is_active=true order by created_at limit 1`
    const entityIds = {}

    for (const def of [...catalogs, ...facts]) {
      const result = await upsertEntity(tx, tenant.id, def, adminRole?.id)
      entityIds[def.slug] = result.id
      console.log(`${def.name}: ${result.added}/${def.fields.length} campos nuevos`)
    }

    for (const [slug, fields] of Object.entries(extensions)) {
      const [entity] = await tx`select id from entities where tenant_id=${tenant.id} and slug=${slug}`
      if (!entity) { console.log(`Aviso: no existe ${slug}; se omitieron sus campos fiscales.`); continue }
      const [{ next }] = await tx`select coalesce(max(sort_order), -1) + 1 as next from entity_fields where entity_id=${entity.id}`
      for (let i = 0; i < fields.length; i++) {
        const field = fields[i]
        await tx`insert into entity_fields (entity_id,name,label,data_type,validation_rules,is_required,sort_order) values (${entity.id},${field.name},${field.label},${field.dataType},${tx.json(field.validationRules)},${field.isRequired},${Number(next)+i}) on conflict (entity_id,name) do nothing`
      }
    }

    // Los importes existentes de los embarques conservan sus datos, pero ahora se presentan como moneda USD.
    const [detailShipments] = await tx`select id from entities where tenant_id=${tenant.id} and slug='detalle_embarques'`
    if (detailShipments) await tx`update entity_fields set data_type='currency', validation_rules=${tx.json({ currency: 'USD', decimals: 2, allowNegative: false, min: 0 })}, updated_at=now() where entity_id=${detailShipments.id} and name in ('precio_unitario_usd','importe_usd') and data_type='number'`

    // (Fase H del dominio fiscal fijo: los folios fiscales ya no viven aquí —
    // la secuencia es cfdi_series.next_folio con lock de fila, ver
    // server/utils/cfdiFolio.ts.)

    for (const [slug, rows] of Object.entries(starterData)) {
      const entityId = entityIds[slug]
      for (const row of rows) {
        const key = row.clave ? ['clave', row.clave] : ['serie', row.serie]
        await tx`
          insert into records (tenant_id, entity_id, custom_data)
          select ${tenant.id}, ${entityId}, ${tx.json(row)}
          where not exists (select 1 from records where tenant_id=${tenant.id} and entity_id=${entityId} and deleted_at is null and custom_data->>${key[0]}=${key[1]})
        `
      }
    }

    const navigation = mergeNavigation(tenant.navigation_layout, entityIds)
    await tx`update tenants set navigation_layout=${tx.json(navigation)}, navigation_revision=navigation_revision+1, updated_at=now() where id=${tenant.id}`

    for (const report of reportDefs) {
      const dsl = {
        title: report.title, baseEntity: report.baseEntity, includeDeletedBase: false, groupBy: [], layout: report.layout,
        columns: report.columns.map(([field, label]) => ({ kind: ['cantidad','total','saldo','subtotal','impuestos'].includes(field) ? 'sumar' : 'detalle', key: field, label, source: { side: 'base', forwardHops: [], field } }))
      }
      await tx`
        insert into print_reports (tenant_id, created_by, title, base_entity_slug, dsl)
        select ${tenant.id}, ${adminUser?.id || null}, ${report.title}, ${report.baseEntity}, ${tx.json(dsl)}
        where not exists (select 1 from print_reports where tenant_id=${tenant.id} and title=${report.title} and base_entity_slug=${report.baseEntity})
      `
    }

    const [moduleCheck] = await tx`
      select count(*)::int as total
      from entities
      where tenant_id=${tenant.id} and slug in ${tx([...catalogs, ...facts].map(entity => entity.slug))}
    `
    const [permissionCheck] = adminRole
      ? await tx`
          select count(*)::int as total
          from role_entity_permissions
          where role_id=${adminRole.id} and entity_id in ${tx(Object.values(entityIds))}
            and can_read=true and can_create=true and can_update=true and can_delete=true
        `
      : [{ total: 0 }]
    const [reportCheck] = await tx`
      select count(*)::int as total
      from print_reports
      where tenant_id=${tenant.id} and title in ${tx(reportDefs.map(report => report.title))}
    `
    if (moduleCheck.total !== catalogs.length + facts.length) throw new Error('La verificación de módulos no coincide con el paquete esperado')
    if (adminRole && permissionCheck.total !== catalogs.length + facts.length) throw new Error('La verificación de permisos administrativos no coincide con el paquete esperado')
    if (reportCheck.total !== reportDefs.length) throw new Error('La verificación de reportes no coincide con el paquete esperado')

    console.log('')
    console.log(`Paquete aplicado a ${tenant.name}: ${catalogs.length} catálogos, ${facts.length} módulos operativos y ${reportDefs.length} reportes.`)
    console.log(`Verificación OK: ${moduleCheck.total} entidades, ${permissionCheck.total} permisos administrativos y ${reportCheck.total} reportes.`)
    console.log('Facturación quedó preparada para PAC; timbrado y cancelación requieren configurar proveedor, certificados y credenciales.')
  })
} finally {
  await db.end()
}
