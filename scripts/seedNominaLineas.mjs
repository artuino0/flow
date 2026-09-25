import 'dotenv/config'
import postgres from 'postgres'
import { randomUUID } from 'node:crypto'

// Agrega a UNA organización el módulo "Líneas de nómina" (una línea por empleado
// y período), sus cálculos y la configuración de la ficha del período para
// editar las líneas en línea. Requiere que seedNominas.mjs ya se haya corrido.
// Es idempotente.
//
// Uso: node scripts/seedNominaLineas.mjs "Nombre de la organización"
const tenantName = process.argv[2]
if (!tenantName) { console.error('Indica el nombre de la organización.'); process.exit(1) }
const sql = postgres(process.env.DATABASE_URL)

const lineFields = [
  ['periodo', 'Período', 'relation', true, { relationEntity: 'periodos_nomina' }],
  ['empleado', 'Empleado', 'relation', true, { relationEntity: 'empleados' }],
  ['dias_trabajados', 'Días trabajados', 'number', false, {}],
  ['sueldo', 'Sueldo', 'currency', false, {}],
  ['bonos', 'Bonos', 'currency', false, {}],
  ['isr', 'ISR', 'currency', false, {}],
  ['imss', 'IMSS', 'currency', false, {}],
  ['bruto', 'Bruto', 'currency', false, { calculation: { kind: 'formula', operator: 'add', leftField: 'sueldo', rightField: 'bonos' } }],
  ['deducciones', 'Deducciones', 'currency', false, { calculation: { kind: 'formula', operator: 'add', leftField: 'isr', rightField: 'imss' } }],
  ['neto', 'Neto', 'currency', false, { calculation: { kind: 'formula', operator: 'subtract', leftField: 'bruto', rightField: 'deducciones' } }]
]

try {
  const [tenant] = await sql`select id from tenants where name = ${tenantName}`
  if (!tenant) throw new Error(`No existe la organización "${tenantName}"`)
  await sql.begin(async tx => {
    const find = async slug => (await tx`select id, detail_layout, label_field from entities where tenant_id = ${tenant.id} and slug = ${slug} limit 1`)[0]
    const periodos = await find('periodos_nomina')
    const empleados = await find('empleados')
    if (!periodos || !empleados) throw new Error('Faltan Empleados o Períodos de nómina: corre primero seedNominas.mjs')

    let lineas = await find('lineas_nomina')
    if (!lineas) {
      ;[lineas] = await tx`
        insert into entities (tenant_id, name, slug, description, icon, singular_name, module_kind)
        values (${tenant.id}, 'Líneas de nómina', 'lineas_nomina', 'Una línea por empleado y período con percepciones, deducciones y neto.', 'ListChecks', 'Línea de nómina', 'hecho')
        returning id
      `
    }
    for (let index = 0; index < lineFields.length; index++) {
      const [name, label, dataType, required, rules] = lineFields[index]
      const [exists] = await tx`select id from entity_fields where entity_id = ${lineas.id} and name = ${name}`
      if (!exists) {
        await tx`insert into entity_fields (entity_id, name, label, data_type, validation_rules, is_required, sort_order)
          values (${lineas.id}, ${name}, ${label}, ${dataType}, ${tx.json(rules)}, ${required}, ${index})`
      }
    }

    // Listado compacto: sin "Días trabajados" para que el Neto quepa en la tabla de la ficha.
    const listLayout = { columns: lineFields.map(([name]) => ({ name, visible: name !== 'dias_trabajados' })), filterFields: [], defaultSort: null }
    await tx`update entities set list_layout = ${tx.json(listLayout)}, updated_at = now() where id = ${lineas.id} and list_layout is null`

    const [total] = await tx`select id from entity_fields where entity_id = ${periodos.id} and name = 'total_neto'`
    if (!total) {
      const [{ next }] = await tx`select coalesce(max(sort_order), -1) + 1 as next from entity_fields where entity_id = ${periodos.id}`
      await tx`insert into entity_fields (entity_id, name, label, data_type, validation_rules, is_required, sort_order)
        values (${periodos.id}, 'total_neto', 'Total neto a pagar', 'currency',
          ${tx.json({ calculation: { kind: 'rollup', aggregate: 'sum', sourceEntity: 'lineas_nomina', relationField: 'periodo', valueField: 'neto' } })}, false, ${next})`
    }

    // La etiqueta de un empleado debe ser su nombre, no el código.
    if (!empleados.label_field) await tx`update entities set label_field = 'nombre_completo', updated_at = now() where id = ${empleados.id}`

    // Ficha del período: líneas editables con totales al pie.
    const names = (await tx`select name from entity_fields where entity_id = ${periodos.id} order by sort_order, created_at`).map(row => row.name)
    const saved = typeof periodos.detail_layout === 'string' ? JSON.parse(periodos.detail_layout) : periodos.detail_layout
    const layout = saved && Array.isArray(saved.properties) ? saved : { properties: [], relations: [], showActivity: false }
    for (const name of names) if (!layout.properties.some(p => p.name === name)) layout.properties.push({ name, visible: true })
    const relation = { entitySlug: 'lineas_nomina', fieldName: 'periodo', visible: true, editable: true, totals: ['bruto', 'deducciones', 'neto'] }
    layout.relations = [...layout.relations.filter(r => !(r.entitySlug === relation.entitySlug && r.fieldName === relation.fieldName)), relation]
    await tx`update entities set detail_layout = ${tx.json(layout)}, updated_at = now() where id = ${periodos.id}`

    const [admin] = await tx`select id from roles where tenant_id = ${tenant.id} and is_system = true limit 1`
    if (admin) {
      await tx`insert into role_entity_permissions (role_id, entity_id, can_read, can_create, can_update, can_delete, show_in_menu)
        values (${admin.id}, ${lineas.id}, true, true, true, true, true)
        on conflict (role_id, entity_id) do update set can_read = true, can_create = true, can_update = true, can_delete = true, show_in_menu = true`
    }

    const [row] = await tx`select navigation_layout from tenants where id = ${tenant.id} for update`
    const raw = typeof row?.navigation_layout === 'string' ? JSON.parse(row.navigation_layout) : row?.navigation_layout
    const nav = raw && Array.isArray(raw.groups) ? structuredClone(raw) : { groups: [] }
    const group = nav.groups.find(item => item.name === 'Nóminas' && !item.parentId)
    if (group && !nav.groups.some(item => (item.entityIds || []).includes(lineas.id))) {
      group.entityIds = [...(group.entityIds || []), lineas.id]
      await tx`update tenants set navigation_layout = ${tx.json(nav)}, navigation_revision = navigation_revision + 1, updated_at = now() where id = ${tenant.id}`
    }
  })
  console.log(`Líneas de nómina configuradas para ${tenantName}`)
} finally {
  await sql.end()
}
