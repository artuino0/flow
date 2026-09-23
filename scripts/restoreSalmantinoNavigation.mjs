import 'dotenv/config'
import postgres from 'postgres'
import { randomUUID } from 'node:crypto'

const db = postgres(process.env.DATABASE_URL)
const tenantId = 'f24e2f9f-aab8-4955-aa13-97f6cd61917f'
const slugs = ['recepciones', 'empaques', 'palets', 'embarques', 'detalle_embarques']

try {
  await db.begin(async tx => {
    const [tenant] = await tx`select id, navigation_layout from tenants where id = ${tenantId} for update`
    if (!tenant) throw new Error('No existe el tenant de Salmantino')
    const modules = await tx`select id, slug from entities where tenant_id = ${tenantId} and slug in ${tx(slugs)}`
    const ids = slugs.map(slug => modules.find(module => module.slug === slug)?.id).filter(Boolean)
    if (ids.length !== slugs.length) throw new Error('Faltan módulos de Empaque y embarque')
    const raw = typeof tenant.navigation_layout === 'string' ? JSON.parse(tenant.navigation_layout) : tenant.navigation_layout
    const layout = structuredClone(raw || { groups: [] })
    let group = layout.groups.find(item => item.name === 'Empaque y embarque' && !item.parentId)
    if (!group) {
      group = { id: randomUUID(), name: 'Empaque y embarque', icon: 'Package', parentId: null, entityIds: [] }
      layout.groups.unshift(group)
    }
    group.entityIds = ids
    await tx`update tenants set navigation_layout = ${tx.json(layout)}, navigation_revision = navigation_revision + 1, updated_at = now() where id = ${tenantId}`
  })
  console.log('Empaque y embarque restaurado y Nóminas conservado.')
} finally {
  await db.end()
}
