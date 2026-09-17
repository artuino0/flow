// Fase H de DOCS/HU_Timbrado_CFDI_PAC.md (2026-09-14, decisión del usuario:
// "todo es prueba aun, no hay ningun dato o tenant real").
//
// Elimina los 5 módulos DINÁMICOS fiscales que la Business Suite sembraba
// antes del dominio fiscal fijo (ahora viven en cfdi_* con UI en /facturacion):
//   series_fiscales, facturas, partidas_factura, notas_credito, complementos_pago
//
// Qué borra por tenant (en este orden, respetando FKs):
//   1. records de esos módulos (record_activities y record_relations caen en cascada)
//   2. print_reports cuya base_entity_slug sea uno de esos módulos
//   3. Limpia tenants.navigation_layout: quita los ids de esos módulos de los
//      grupos y elimina el grupo "Facturación" si quedó vacío (la entrada de
//      Facturación ahora es fija en AppNav, no un grupo dinámico)
//   4. entities (entity_fields → history/counters, files, triggers y
//      relation_definitions caen en cascada)
//
// NOTA: los binarios en disco de `files` (xml/pdf adjuntos de prueba) NO se
// borran — son datos de prueba y el disco se limpia aparte si hace falta.
// Idempotente: se puede correr varias veces.
//
// Uso:
//   node scripts/removeFiscalDynamicModules.mjs            # todos los tenants
//   node scripts/removeFiscalDynamicModules.mjs <tenantId|slug>   # uno solo

import 'dotenv/config'
import postgres from 'postgres'

const SLUGS = ['series_fiscales', 'facturas', 'partidas_factura', 'notas_credito', 'complementos_pago']
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://erp_admin:changeme@localhost:5433/erp_dinamico'

const tenantRef = process.argv[2] || null
const db = postgres(DATABASE_URL)

try {
  await db.begin(async (tx) => {
    const tenants = tenantRef
      ? await tx`select id, name, slug, navigation_layout, navigation_revision from tenants where id::text = ${tenantRef} or slug = ${tenantRef} for update`
      : await tx`select id, name, slug, navigation_layout, navigation_revision from tenants for update`
    if (tenantRef && !tenants.length) throw new Error(`No existe la organización "${tenantRef}"`)

    let totalRecords = 0
    let totalEntities = 0
    let totalReports = 0

    for (const tenant of tenants) {
      const entities = await tx`select id, slug from entities where tenant_id = ${tenant.id} and slug in ${tx(SLUGS)} for update`
      const entityIds = entities.map((e) => e.id)

      const reports = await tx`delete from print_reports where tenant_id = ${tenant.id} and base_entity_slug in ${tx(SLUGS)}`
      totalReports += reports.count

      let deletedRecords = 0
      if (entityIds.length) {
        const records = await tx`delete from records where tenant_id = ${tenant.id} and entity_id in ${tx(entityIds)}`
        deletedRecords = records.count
      }
      totalRecords += deletedRecords

      // navigation_layout: quitar ids huérfanos y el grupo "Facturación" vacío
      const layout = tenant.navigation_layout ?? { groups: [] }
      const removed = new Set(entityIds)
      let layoutChanged = false
      const groups = (Array.isArray(layout.groups) ? layout.groups : [])
        .map((group) => {
          const before = (group.entityIds || []).length
          const entityIdsFiltrados = (group.entityIds || []).filter((id) => !removed.has(id))
          if (entityIdsFiltrados.length !== before) layoutChanged = true
          return { ...group, entityIds: entityIdsFiltrados }
        })
        .filter((group) => {
          const vacioFiscal = group.name === 'Facturación' && !(group.entityIds || []).length && !(group.children || []).length
          if (vacioFiscal) layoutChanged = true
          return !vacioFiscal
        })
      if (layoutChanged) {
        await tx`update tenants set navigation_layout = ${tx.json({ ...layout, groups })}, navigation_revision = navigation_revision + 1, updated_at = now() where id = ${tenant.id}`
      }

      if (entityIds.length) {
        const deleted = await tx`delete from entities where id in ${tx(entityIds)}`
        totalEntities += deleted.count
      }

      if (entityIds.length || reports.count) {
        console.log(`${tenant.name} (${tenant.slug}): ${deletedRecords} registros, ${entityIds.length} módulos, ${reports.count} reportes eliminados`)
      }
    }

    console.log('')
    console.log(`Limpieza lista: ${totalEntities} módulos dinámicos fiscales, ${totalRecords} registros y ${totalReports} reportes eliminados.`)
    console.log('La facturación ahora vive en el dominio fijo (cfdi_*) — ver /facturacion y DOCS/HU_Timbrado_CFDI_PAC.md.')
  })
} finally {
  await db.end()
}
