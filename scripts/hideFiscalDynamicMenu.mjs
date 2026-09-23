import 'dotenv/config'
import postgres from 'postgres'

const db = postgres(process.env.DATABASE_URL)
const slugs = ['series_fiscales', 'facturas', 'partidas_factura', 'notas_credito', 'complementos_pago']

try {
  await db.begin(async tx => {
    const tenants = await tx`select id, navigation_layout from tenants for update`
    for (const tenant of tenants) {
      const fiscalEntities = await tx`select id from entities where tenant_id = ${tenant.id} and slug in ${tx(slugs)}`
      const ids = fiscalEntities.map(entity => entity.id)
      if (!ids.length) continue

      await tx`
        update role_entity_permissions
        set show_in_menu = false
        where entity_id in ${tx(ids)}
      `

      const raw = typeof tenant.navigation_layout === 'string' ? JSON.parse(tenant.navigation_layout) : tenant.navigation_layout
      const layout = raw || { groups: [] }
      const removed = new Set(ids)
      const groups = (layout.groups || []).map(group => ({
        ...group,
        entityIds: (group.entityIds || []).filter(id => !removed.has(id))
      }))
      await tx`update tenants set navigation_layout = ${tx.json({ ...layout, groups })}, navigation_revision = navigation_revision + 1, updated_at = now() where id = ${tenant.id}`
    }
  })
  console.log('Módulos fiscales dinámicos ocultos del menú; sus datos y rutas se conservaron.')
} finally {
  await db.end()
}
