/**
 * Paquete demo de Agenda y cobranza para un tenant existente.
 *
 * Uso:
 *   node scripts/seedAgendaSuite.mjs <tenant-id-o-slug> [meses]
 *
 * Crea catálogos, módulos operativos, tableros y datos históricos. Es
 * idempotente por código/folio y nunca opera sobre otro tenant.
 */
import 'dotenv/config'
import postgres from 'postgres'
import { randomUUID } from 'node:crypto'

const connectionString = process.env.APP_DATABASE_URL || process.env.DATABASE_URL
const tenantRef = process.argv[2]
const months = Math.max(1, Math.min(12, Number(process.argv[3] || 3)))
if (!connectionString) throw new Error('Configura APP_DATABASE_URL o DATABASE_URL')
if (!tenantRef) throw new Error('Uso: node scripts/seedAgendaSuite.mjs <tenant-id-o-slug> [meses]')

const db = postgres(connectionString, { max: 1, prepare: false })
const option = (value, label, color) => ({ value, label, ...(color ? { color } : {}) })
const text = (name, label, required = false, maxLength = 180) => ({ name, label, dataType: 'text', isRequired: required, validationRules: { maxLength } })
const number = (name, label, required = false, rules = { min: 0 }) => ({ name, label, dataType: 'number', isRequired: required, validationRules: rules })
const money = (name, label, required = false, extraRules = {}) => ({ name, label, dataType: 'currency', isRequired: Object.keys(extraRules).includes('calculation') ? false : required, validationRules: { currency: 'tenant', decimals: 2, allowNegative: false, min: 0, ...extraRules } })
const date = (name, label, required = false) => ({ name, label, dataType: 'date', isRequired: required, validationRules: {} })
const bool = (name, label, required = false) => ({ name, label, dataType: 'boolean', isRequired: required, validationRules: {} })
const relation = (name, label, relationEntity, required = false) => ({ name, label, dataType: 'relation', isRequired: required, validationRules: { relationEntity } })
const select = (name, label, options, required = false) => ({ name, label, dataType: 'select', isRequired: required, validationRules: { options } })
const active = [option('activo', 'Activo', 'success'), option('inactivo', 'Inactivo', 'gray')]
const appointmentStatus = [
  option('pendiente', 'Pendiente', 'gray'), option('confirmada', 'Confirmada', 'blue'),
  option('en_atencion', 'En atención', 'warning'), option('completada', 'Completada', 'success'),
  option('no_asistio', 'No asistió', 'error'), option('cancelada', 'Cancelada', 'error')
]
const receivableStatus = [
  option('borrador', 'Borrador', 'gray'), option('vigente', 'Vigente', 'blue'),
  option('pagado', 'Pagado', 'success'), option('vencido', 'Vencido', 'error'),
  option('cancelado', 'Cancelado', 'error')
]
const paymentStatus = [option('borrador', 'Borrador', 'gray'), option('aplicado', 'Aplicado', 'success'), option('cancelado', 'Cancelado', 'error')]
const channels = [option('web', 'Sitio web', 'blue'), option('telefono', 'Teléfono'), option('whatsapp', 'WhatsApp', 'success'), option('mostrador', 'Mostrador')]

const definitions = [
  {
    slug: 'clientes', name: 'Clientes', singularName: 'Cliente', icon: 'Users', moduleKind: 'dimension', labelField: 'nombre',
    fields: [text('codigo', 'Código', true, 20), text('nombre', 'Nombre completo', true), text('telefono', 'Teléfono', false, 30), text('email', 'Correo electrónico'), text('razon_social', 'Razón social'), text('rfc', 'RFC', false, 20), text('regimen_fiscal', 'Régimen fiscal'), text('codigo_postal_fiscal', 'Código postal fiscal', false, 10), text('uso_cfdi', 'Uso de CFDI', false, 10), select('estado', 'Estado', active, true)]
  },
  {
    slug: 'servicios', name: 'Servicios', singularName: 'Servicio', icon: 'BriefcaseBusiness', moduleKind: 'dimension', labelField: 'nombre',
    fields: [text('codigo', 'Código', true, 20), text('nombre', 'Nombre', true), text('descripcion', 'Descripción', false, 500), number('duracion_minutos', 'Duración en minutos', true, { min: 15, max: 480, integer: true }), money('precio', 'Precio', true), text('clave_prod_serv', 'Clave SAT', false, 8), select('estado', 'Estado', active, true)]
  },
  {
    slug: 'profesionales', name: 'Asesores', singularName: 'Asesor', icon: 'UserRoundCheck', moduleKind: 'dimension', labelField: 'nombre',
    fields: [text('codigo', 'Código', true, 20), text('nombre', 'Nombre completo', true), text('especialidad', 'Especialidad'), text('telefono', 'Teléfono', false, 30), text('email', 'Correo electrónico'), select('estado', 'Estado', active, true)]
  },
  {
    slug: 'sucursales', name: 'Sucursales', singularName: 'Sucursal', icon: 'MapPin', moduleKind: 'dimension', labelField: 'nombre',
    fields: [text('codigo', 'Código', true, 20), text('nombre', 'Nombre', true), text('direccion', 'Dirección', false, 300), text('telefono', 'Teléfono', false, 30), select('estado', 'Estado', active, true)]
  },
  {
    slug: 'condiciones_pago', name: 'Condiciones de pago', singularName: 'Condición de pago', icon: 'CalendarClock', moduleKind: 'dimension', labelField: 'nombre',
    fields: [text('clave', 'Clave', true, 20), text('nombre', 'Nombre', true), number('dias_credito', 'Días de crédito', true, { min: 0, integer: true }), select('estado', 'Estado', active, true)]
  },
  {
    slug: 'metodos_pago', name: 'Métodos de pago', singularName: 'Método de pago', icon: 'WalletCards', moduleKind: 'dimension', labelField: 'nombre',
    fields: [text('clave', 'Clave', true, 10), text('nombre', 'Nombre', true), select('estado', 'Estado', active, true)]
  },
  {
    slug: 'cuentas_bancarias', name: 'Cuentas bancarias', singularName: 'Cuenta bancaria', icon: 'Landmark', moduleKind: 'dimension', labelField: 'nombre',
    fields: [text('codigo', 'Código', true, 20), text('nombre', 'Nombre', true), text('banco', 'Banco', true), text('numero_cuenta', 'Número de cuenta', false, 30), text('clabe', 'CLABE', false, 18), select('moneda', 'Moneda', [option('MXN', 'MXN · Peso mexicano')], true), select('estado', 'Estado', active, true)]
  },
  {
    slug: 'citas', name: 'Citas', singularName: 'Cita', icon: 'CalendarDays', moduleKind: 'hecho', labelField: 'folio',
    boardConfig: { enabled: true, statusField: 'estado', titleField: 'folio', secondaryFields: ['cliente', 'servicio', 'fecha'], defaultView: 'board' },
    fields: [text('folio', 'Folio', true, 30), relation('cliente', 'Cliente', 'clientes', true), relation('servicio', 'Servicio', 'servicios', true), relation('profesional', 'Asesor', 'profesionales', true), relation('sucursal', 'Sucursal', 'sucursales', true), date('fecha', 'Fecha', true), text('hora_inicio', 'Hora de inicio', true, 5), number('duracion_minutos', 'Duración en minutos', true, { min: 15, max: 480, integer: true }), money('precio', 'Precio', true), select('canal', 'Canal de reserva', channels, true), select('estado', 'Estado', appointmentStatus, true), bool('requiere_factura', 'Requiere factura'), text('notas', 'Notas', false, 600)]
  },
  {
    slug: 'cuentas_por_cobrar', name: 'Cuentas por cobrar', singularName: 'Cuenta por cobrar', icon: 'HandCoins', moduleKind: 'hecho', labelField: 'folio',
    boardConfig: { enabled: true, statusField: 'estado', titleField: 'folio', secondaryFields: ['cliente', 'total', 'fecha_vencimiento'], defaultView: 'board' },
    fields: [text('folio', 'Folio', true, 30), relation('cliente', 'Cliente', 'clientes', true), relation('cita', 'Cita relacionada', 'citas'), text('numero_documento', 'Número de documento', true, 50), select('tipo_documento', 'Tipo de documento', [option('servicio', 'Servicio'), option('factura', 'Factura'), option('nota_cargo', 'Nota de cargo')], true), date('fecha_emision', 'Fecha de emisión', true), date('fecha_vencimiento', 'Fecha de vencimiento', true), relation('condicion_pago', 'Condición de pago', 'condiciones_pago'), select('moneda', 'Moneda', [option('MXN', 'MXN · Peso mexicano')], true), money('subtotal', 'Subtotal', true), money('impuestos', 'Impuestos', true), money('total', 'Total', true), money('total_pagado', 'Total pagado', false, { calculation: { kind: 'rollup', aggregate: 'sum', sourceEntity: 'aplicaciones_cobro', relationField: 'cuenta_por_cobrar', valueField: 'monto' } }), money('saldo', 'Saldo pendiente', false, { calculation: { kind: 'formula', operator: 'subtract', leftField: 'total', rightField: 'total_pagado' } }), select('estado', 'Estado', receivableStatus, true), text('observaciones', 'Observaciones', false, 500)]
  },
  {
    slug: 'cobros_cliente', name: 'Cobros de clientes', singularName: 'Cobro de cliente', icon: 'BadgeDollarSign', moduleKind: 'hecho', labelField: 'folio',
    fields: [text('folio', 'Folio', true, 30), date('fecha', 'Fecha de cobro', true), relation('cliente', 'Cliente', 'clientes', true), relation('cuenta_bancaria', 'Cuenta bancaria', 'cuentas_bancarias', true), relation('metodo_pago', 'Método de pago', 'metodos_pago', true), text('referencia', 'Referencia', false, 80), select('moneda', 'Moneda', [option('MXN', 'MXN · Peso mexicano')], true), money('monto', 'Monto', true), select('estado', 'Estado', paymentStatus, true), text('observaciones', 'Observaciones', false, 500)]
  },
  {
    slug: 'aplicaciones_cobro', name: 'Aplicaciones de cobro', singularName: 'Aplicación de cobro', icon: 'Link2', moduleKind: 'hecho', labelField: 'codigo',
    fields: [text('codigo', 'Código', true, 30), relation('cobro', 'Cobro', 'cobros_cliente', true), relation('cuenta_por_cobrar', 'Cuenta por cobrar', 'cuentas_por_cobrar', true), date('fecha', 'Fecha', true), money('monto', 'Monto aplicado', true)]
  }
]

const dayMs = 86_400_000
const dateOnly = value => value.toISOString().slice(0, 10)
const addDays = (value, days) => new Date(value.getTime() + days * dayMs)
const roundMoney = value => Math.round(value * 100) / 100
const pad = (value, size = 6) => String(value).padStart(size, '0')

function layouts(def) {
  const columns = def.fields.slice(0, def.moduleKind === 'hecho' ? 9 : 7).map(field => ({ name: field.name, visible: true }))
  return {
    list: { columns, filterFields: def.fields.filter(field => ['select', 'relation', 'date'].includes(field.dataType)).slice(0, 7).map(field => field.name), defaultSort: def.fields.some(field => field.name === 'fecha') ? { field: 'fecha', dir: 'desc' } : null },
    detail: { properties: def.fields.map(field => ({ name: field.name, visible: true })), relations: [], showActivity: true }
  }
}

async function upsertEntity(tx, tenantId, def, adminRoleId) {
  const layout = layouts(def)
  await tx`
    insert into entities (tenant_id,name,slug,description,icon,module_kind,label_field,singular_name,list_layout,detail_layout,board_config)
    values (${tenantId},${def.name},${def.slug},${`Paquete demo Agenda · ${def.name}`},${def.icon},${def.moduleKind},${def.labelField || null},${def.singularName || null},${tx.json(layout.list)},${tx.json(layout.detail)},${def.boardConfig ? tx.json(def.boardConfig) : null})
    on conflict (tenant_id,slug) do update set
      name=excluded.name, description=excluded.description, icon=excluded.icon,
      label_field=coalesce(entities.label_field,excluded.label_field), singular_name=coalesce(entities.singular_name,excluded.singular_name),
      list_layout=excluded.list_layout, detail_layout=excluded.detail_layout,
      board_config=coalesce(excluded.board_config,entities.board_config), updated_at=now()
  `
  const [entity] = await tx`select id from entities where tenant_id=${tenantId} and slug=${def.slug}`
  for (let i = 0; i < def.fields.length; i++) {
    const field = def.fields[i]
    await tx`
      insert into entity_fields (entity_id,name,label,data_type,validation_rules,is_required,sort_order)
      values (${entity.id},${field.name},${field.label},${field.dataType},${tx.json(field.validationRules)},${field.isRequired},${i})
      on conflict (entity_id,name) do update set label=excluded.label, validation_rules=excluded.validation_rules, is_required=excluded.is_required, sort_order=excluded.sort_order, updated_at=now()
    `
  }
  if (adminRoleId) await tx`
    insert into role_entity_permissions (role_id,entity_id,can_read,can_create,can_update,can_delete,show_in_menu)
    values (${adminRoleId},${entity.id},true,true,true,true,true)
    on conflict (role_id,entity_id) do update set can_read=true,can_create=true,can_update=true,can_delete=true,show_in_menu=true
  `
  return entity.id
}

async function ensureRecord(tx, tenantId, entityId, keyField, keyValue, data, createdAt = new Date()) {
  const [existing] = await tx`select id from records where tenant_id=${tenantId} and entity_id=${entityId} and deleted_at is null and custom_data->>${keyField}=${String(keyValue)} limit 1`
  if (existing) return existing.id
  const [created] = await tx`insert into records (tenant_id,entity_id,custom_data,created_at,updated_at) values (${tenantId},${entityId},${tx.json(data)},${createdAt},${createdAt}) returning id`
  return created.id
}

function mergeNavigation(layout, ids) {
  const groups = Array.isArray(layout?.groups) ? structuredClone(layout.groups) : []
  const managed = new Set(['citas', 'cuentas_por_cobrar', 'cobros_cliente', 'aplicaciones_cobro'].map(slug => ids[slug]))
  for (const group of groups) group.entityIds = (group.entityIds || []).filter(id => !managed.has(id))
  let agenda = groups.find(group => group.name === 'Agenda' && !group.parentId)
  if (!agenda) { agenda = { id: randomUUID(), name: 'Agenda', icon: 'CalendarDays', parentId: null, entityIds: [] }; groups.push(agenda) }
  agenda.entityIds = [ids.citas]
  let cobranza = groups.find(group => group.name === 'Cobranza' && group.parentId === agenda.id)
  if (!cobranza) { cobranza = { id: randomUUID(), name: 'Cobranza', icon: 'HandCoins', parentId: agenda.id, entityIds: [] }; groups.push(cobranza) }
  cobranza.entityIds = [ids.cuentas_por_cobrar, ids.cobros_cliente, ids.aplicaciones_cobro]
  return { ...(layout || {}), groups }
}

const clients = [
  'Sofía Ramírez','Carlos Mendoza','Valeria Torres','Diego Navarro','Mariana López','Jorge Castillo','Fernanda Ruiz','Andrés Silva',
  'Camila Ortega','Ricardo Flores','Daniela Vargas','Miguel Herrera','Paola Cruz','Alejandro Morales','Renata Chávez','Eduardo Reyes',
  'Natalia Romero','Roberto Aguilar','Gabriela Medina','Luis Campos','Isabella Vega','Fernando Ríos','Regina Soto','Manuel Cabrera',
  'Lucía Fuentes','Emilio Luna','Andrea Salazar','Héctor Valdez','Carolina Ibarra','Óscar Sandoval'
]
const services = [
  ['SRV-01','Planeación de viaje nacional',60,850,'90121502'], ['SRV-02','Planeación de viaje internacional',90,1450,'90121502'],
  ['SRV-03','Asesoría de visa y documentación',60,1100,'80101604'], ['SRV-04','Diseño de luna de miel',90,1800,'90121502'],
  ['SRV-05','Viaje corporativo',60,1600,'90121502'], ['SRV-06','Cotización de grupos',75,1350,'90121502'],
  ['SRV-07','Revisión de itinerario',45,650,'90121502'], ['SRV-08','Asesoría de crucero',60,1250,'90121502']
]
const advisors = [
  ['ASE-01','María Fernanda Ortiz','Viajes internacionales'], ['ASE-02','José Luis Paredes','Viajes nacionales'],
  ['ASE-03','Ana Sofía Martínez','Lunas de miel'], ['ASE-04','Daniel Hernández','Grupos y corporativos'], ['ASE-05','Laura Méndez','Visas y documentación']
]

try {
  await db.begin(async tx => {
    const [tenant] = await tx`select id,name,slug,navigation_layout from tenants where id::text=${tenantRef} or slug=${tenantRef} for update`
    if (!tenant) throw new Error(`No existe el tenant "${tenantRef}"`)
    await tx`select set_config('app.tenant_id',${tenant.id},true), set_config('app.person_id','00000000-0000-0000-0000-000000000000',true)`
    const [adminRole] = await tx`select id from roles where tenant_id=${tenant.id} and is_system=true order by created_at limit 1`
    const ids = {}
    for (const def of definitions) ids[def.slug] = await upsertEntity(tx, tenant.id, def, adminRole?.id)

    const conditionId = await ensureRecord(tx, tenant.id, ids.condiciones_pago, 'clave', 'CONTADO', { clave: 'CONTADO', nombre: 'Contado', dias_credito: 0, estado: 'activo' })
    const methods = []
    for (const row of [['01','Efectivo'],['03','Transferencia electrónica'],['04','Tarjeta de crédito']]) methods.push(await ensureRecord(tx, tenant.id, ids.metodos_pago, 'clave', row[0], { clave: row[0], nombre: row[1], estado: 'activo' }))
    const bankId = await ensureRecord(tx, tenant.id, ids.cuentas_bancarias, 'codigo', 'CTA-01', { codigo: 'CTA-01', nombre: 'Cuenta principal', banco: 'Banco demo', numero_cuenta: '****4821', clabe: '000000000000000000', moneda: 'MXN', estado: 'activo' })
    const branchIds = [
      await ensureRecord(tx, tenant.id, ids.sucursales, 'codigo', 'SUC-01', { codigo: 'SUC-01', nombre: 'Oficina Centro', direccion: 'Zona Centro', telefono: '477 555 0101', estado: 'activo' }),
      await ensureRecord(tx, tenant.id, ids.sucursales, 'codigo', 'SUC-02', { codigo: 'SUC-02', nombre: 'Atención en línea', direccion: 'Servicio remoto', telefono: '477 555 0102', estado: 'activo' })
    ]
    const advisorIds = []
    for (const [codigo,nombre,especialidad] of advisors) advisorIds.push(await ensureRecord(tx, tenant.id, ids.profesionales, 'codigo', codigo, { codigo,nombre,especialidad,telefono:'477 555 01'+codigo.slice(-2),email:`${codigo.toLowerCase()}@dyda.travel`,estado:'activo' }))
    const serviceRows = []
    for (const [codigo,nombre,duracion,precio,clave] of services) {
      const id = await ensureRecord(tx, tenant.id, ids.servicios, 'codigo', codigo, { codigo,nombre,descripcion:`Sesión personalizada de ${nombre.toLowerCase()}.`,duracion_minutos:duracion,precio,clave_prod_serv:clave,estado:'activo' })
      serviceRows.push({ id, codigo, nombre, duracion, precio })
    }
    const clientIds = []
    for (let i = 0; i < clients.length; i++) {
      const codigo = `CLI-${pad(i + 1, 4)}`
      const nombre = clients[i]
      const email = `${nombre.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z]+/g,'.').replace(/^\.|\.$/g,'')}@example.com`
      clientIds.push(await ensureRecord(tx, tenant.id, ids.clientes, 'codigo', codigo, { codigo,nombre,telefono:`477 32${pad(10000 + i,5)}`,email,razon_social:nombre,rfc:'XAXX010101000',regimen_fiscal:'616',codigo_postal_fiscal:'37000',uso_cfdi:'S01',estado:'activo' }))
    }

    const today = new Date(); today.setUTCHours(12,0,0,0)
    const daysBack = Math.round(months * 30)
    const appointmentCount = Math.max(90, months * 80)
    let receivableCount = 0; let paymentCount = 0
    for (let i = 0; i < appointmentCount; i++) {
      const offset = -daysBack + (i % (daysBack + 22))
      const appointmentDate = addDays(today, offset)
      const service = serviceRows[i % serviceRows.length]
      const client = clientIds[(i * 7) % clientIds.length]
      const folio = `CIT-${pad(i + 1)}`
      let estado = offset >= 0 ? (i % 3 ? 'confirmada' : 'pendiente') : 'completada'
      if (offset < 0 && i % 17 === 0) estado = 'cancelada'
      else if (offset < 0 && i % 11 === 0) estado = 'no_asistio'
      const hour = 9 + (i % 9)
      const createdAt = addDays(appointmentDate, -Math.min(21, 2 + (i % 18)))
      const citaId = await ensureRecord(tx, tenant.id, ids.citas, 'folio', folio, {
        folio,cliente:client,servicio:service.id,profesional:advisorIds[i % advisorIds.length],sucursal:branchIds[i % branchIds.length],
        fecha:dateOnly(appointmentDate),hora_inicio:`${pad(hour,2)}:${i % 2 ? '30' : '00'}`,duracion_minutos:service.duracion,precio:service.precio,
        canal:['web','telefono','whatsapp','mostrador'][i % 4],estado,requiere_factura:i % 3 === 0,notas:i % 9 === 0 ? 'Cliente solicita seguimiento por WhatsApp.' : ''
      }, createdAt)
      if (estado !== 'completada') continue

      receivableCount += 1
      const subtotal = roundMoney(service.precio / 1.16)
      const impuestos = roundMoney(service.precio - subtotal)
      const paymentMode = i % 5
      const paid = paymentMode === 0 ? 0 : paymentMode === 1 ? roundMoney(service.precio * 0.5) : service.precio
      const saldo = roundMoney(service.precio - paid)
      const dueDate = addDays(appointmentDate, 7)
      const cxcFolio = pad(100000 + receivableCount)
      const cxcStatus = saldo === 0 ? 'pagado' : dueDate < today ? 'vencido' : 'vigente'
      const cxcId = await ensureRecord(tx, tenant.id, ids.cuentas_por_cobrar, 'folio', cxcFolio, {
        folio:cxcFolio,cliente:client,cita:citaId,numero_documento:folio,tipo_documento:i % 3 === 0 ? 'factura' : 'servicio',fecha_emision:dateOnly(appointmentDate),fecha_vencimiento:dateOnly(dueDate),
        condicion_pago:conditionId,moneda:'MXN',subtotal,impuestos,total:service.precio,total_pagado:paid,saldo,estado:cxcStatus,observaciones:i % 3 === 0 ? 'Pendiente de emisión fiscal desde Facturación.' : 'Servicio de asesoría.'
      }, appointmentDate)
      if (!paid) continue

      paymentCount += 1
      const paymentDate = addDays(appointmentDate, 1 + (i % 4))
      const cobroFolio = pad(200000 + paymentCount)
      const cobroId = await ensureRecord(tx, tenant.id, ids.cobros_cliente, 'folio', cobroFolio, {
        folio:cobroFolio,fecha:dateOnly(paymentDate),cliente:client,cuenta_bancaria:bankId,metodo_pago:methods[i % methods.length],referencia:`REF-${pad(paymentCount,5)}`,moneda:'MXN',monto:paid,estado:'aplicado',observaciones:saldo ? 'Pago parcial.' : 'Pago total.'
      }, paymentDate)
      await ensureRecord(tx, tenant.id, ids.aplicaciones_cobro, 'codigo', `APL-${pad(paymentCount)}`, { codigo:`APL-${pad(paymentCount)}`,cobro:cobroId,cuenta_por_cobrar:cxcId,fecha:dateOnly(paymentDate),monto:paid }, paymentDate)
    }

    const navigation = mergeNavigation(tenant.navigation_layout, ids)
    await tx`update tenants set navigation_layout=${tx.json(navigation)},navigation_revision=navigation_revision+1,updated_at=now() where id=${tenant.id}`
    console.log(JSON.stringify({ tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug }, months, modules: definitions.length, clients: clients.length, appointments: appointmentCount, receivables: receivableCount, payments: paymentCount }, null, 2))
  })
} finally {
  await db.end()
}