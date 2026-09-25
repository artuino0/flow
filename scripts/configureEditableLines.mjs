import 'dotenv/config'
import postgres from 'postgres'

// Activa las líneas editables en la ficha de un módulo padre y, opcionalmente,
// convierte campos del módulo hijo en cálculos de resta/suma/etc. Es idempotente.
//
// Uso:
//   node scripts/configureEditableLines.mjs "Organización" padre hijo campo_relacion total1,total2 [campo=operador:izq:der ...]
// Ej.: node scripts/configureEditableLines.mjs "Grupo Agrícola Salmantino" conteos_inventario conteo_partidas conteo diferencia diferencia=subtract:cantidad_contada:existencia_sistema
const [tenantName, parentSlug, childSlug, relationField, totalsArg = '', ...calcArgs] = process.argv.slice(2)
if (!tenantName || !parentSlug || !childSlug || !relationField) {
  console.error('Uso: configureEditableLines.mjs "Organización" padre hijo campo_relacion [totales,] [campo=operador:izq:der ...]')
  process.exit(1)
}
const totals = totalsArg.split(',').map(name => name.trim()).filter(Boolean)
const sql = postgres(process.env.DATABASE_URL)

try {
  await sql.begin(async tx => {
    const [tenant] = await tx`select id from tenants where name = ${tenantName} or id::text = ${tenantName} or slug = ${tenantName}`
    if (!tenant) throw new Error(`No existe la organización "${tenantName}"`)
    const find = async slug => (await tx`select id, detail_layout from entities where tenant_id = ${tenant.id} and slug = ${slug} limit 1`)[0]
    const parent = await find(parentSlug)
    const child = await find(childSlug)
    if (!parent || !child) throw new Error('No existe el módulo padre o el hijo')

    const childFields = await tx`select id, name, data_type, validation_rules from entity_fields where entity_id = ${child.id}`
    const relation = childFields.find(field => field.name === relationField && field.data_type === 'relation')
    const relationEntity = relation && (typeof relation.validation_rules === 'string' ? JSON.parse(relation.validation_rules) : relation.validation_rules)?.relationEntity
    if (relationEntity !== parentSlug) throw new Error(`"${relationField}" debe ser una relación del hijo hacia "${parentSlug}"`)
    const numeric = new Set(childFields.filter(field => ['number', 'currency'].includes(field.data_type)).map(field => field.name))
    for (const name of totals) if (!numeric.has(name)) throw new Error(`"${name}" no es un campo numérico del hijo`)

    for (const arg of calcArgs) {
      const [name, expression] = arg.split('=')
      const [operator, leftField, rightField] = (expression ?? '').split(':')
      const field = childFields.find(item => item.name === name)
      if (!field || !numeric.has(name) || !['add', 'subtract', 'multiply', 'divide'].includes(operator) || !numeric.has(leftField) || !numeric.has(rightField)) {
        throw new Error(`Cálculo inválido: ${arg}`)
      }
      const rules = typeof field.validation_rules === 'string' ? JSON.parse(field.validation_rules) : (field.validation_rules ?? {})
      await tx`update entity_fields set validation_rules = ${tx.json({ ...rules, calculation: { kind: 'formula', operator, leftField, rightField } })}, updated_at = now() where id = ${field.id}`
    }

    const names = (await tx`select name from entity_fields where entity_id = ${parent.id} order by sort_order, created_at`).map(row => row.name)
    const saved = typeof parent.detail_layout === 'string' ? JSON.parse(parent.detail_layout) : parent.detail_layout
    const layout = saved && Array.isArray(saved.properties) ? saved : { properties: [], relations: [], showActivity: false }
    for (const name of names) if (!layout.properties.some(item => item.name === name)) layout.properties.push({ name, visible: true })
    const entry = { entitySlug: childSlug, fieldName: relationField, visible: true, editable: true, totals }
    layout.relations = [...layout.relations.filter(item => !(item.entitySlug === childSlug && item.fieldName === relationField)), entry]
    await tx`update entities set detail_layout = ${tx.json(layout)}, updated_at = now() where id = ${parent.id}`
  })
  console.log(`Líneas editables activadas: ${parentSlug} → ${childSlug} (${tenantName})`)
} finally {
  await sql.end()
}
