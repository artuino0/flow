// Add the requested navigation to the existing demo, without modifying records
// or replacing an organization that someone has already configured.
import 'dotenv/config'
import postgres from 'postgres'
import { randomUUID } from 'node:crypto'
const db = postgres(process.env.APP_DATABASE_URL || process.env.DATABASE_URL || 'postgresql://erp_app:changeme_app@localhost:5433/erp_dinamico')
try {
  await db.begin(async tx => {
    const [tenant] = await tx`select id, navigation_layout from tenants where slug = 'grupo-agricola-salmantino' for update`
    if (!tenant) throw new Error('No existe la organización Salmantino')
    if (tenant.navigation_layout.groups.length) {
      const layout = tenant.navigation_layout
      const icons = { factory: 'Factory', package: 'Package' }
      const production = layout.groups.find(group => group.name === 'Producción' && !group.parentId && !group.entityIds.length)
      const packing = layout.groups.find(group => group.name === 'Empaque y embarque' && group.parentId === production?.id)
      if (production && packing) {
        for (const group of layout.groups) if (group.parentId === production.id) group.parentId = null
        layout.groups = layout.groups.filter(group => group.id !== production.id)
      }
      if ((production && packing) || layout.groups.some(group => icons[group.icon])) {
        for (const group of layout.groups) group.icon = icons[group.icon] || group.icon
        await tx`update tenants set navigation_layout = ${tx.json(layout)}, navigation_revision = navigation_revision + 1 where id = ${tenant.id}`
      }
      console.log('Salmantino ya tiene una organización del menú; se conserva.'); return
    }
    await tx`select set_config('app.tenant_id', ${tenant.id}, true), set_config('app.person_id', '00000000-0000-0000-0000-000000000000', true)`
    const modules = await tx`select id, slug from entities where tenant_id = ${tenant.id}`
    const ordered = ['recepciones', 'empaques', 'palets', 'embarques', 'detalle_embarques']
    const ids = ordered.flatMap(slug => modules.find(module => module.slug === slug)?.id ?? [])
    if (ids.length !== ordered.length) throw new Error('Faltan módulos de la demostración; no se aplicó ningún cambio')
    const areaId = randomUUID()
    const layout = { groups: [
      { id: areaId, name: 'Empaque y embarque', icon: 'Package', parentId: null, entityIds: ids }
    ] }
    await tx`update tenants set navigation_layout = ${tx.json(layout)}, navigation_revision = navigation_revision + 1 where id = ${tenant.id}`
    console.log(`Empaque y embarque: ${ids.length} módulos organizados.`)
  })
} finally { await db.end() }
