// Seed condicional de metadatos: crea las entities/entity_fields del flujo
// Recepcion -> Empaque -> Embarque (pedido directo del usuario 2026-09-01:
// "es la recepcion el empaque y el embarque (por el destino de mercado) si
// quiero poder capturar esos datos y generar ese reporte luego" - el usuario
// eligio explicitamente "Constrúyelo en ERP-Dinámico" via AskUserQuestion en
// vez de solo una explicacion de diseño).
//
// Mismo patron que scripts/seed.mjs (HU-ERD-25): insert directo a
// entities/entity_fields con ON CONFLICT DO NOTHING (idempotente), y permiso
// CRUD total al rol Administrador del tenant - la MISMA logica que ya aplica
// createEntity() (server/utils/moduleEntities.ts, HU-ERD-66) para modulos
// creados desde el Constructor de Modulos via UI. Se elige un script de seed
// (en vez de una sola llamada http imperativa a POST /api/entities) para que
// la definicion del modulo quede versionada en el repo, no solo mutada una
// vez en una base de datos de una sesion - mismo criterio que ya establecio
// scripts/seed.mjs para el modulo CRM/Directorio.
//
// Uso:
//   node scripts/seedEmpaque.mjs <tenantId>
//
// Diseño del modelo de datos (detalle completo en
// DOCS/Flujo_Recepcion_Empaque_Embarque.md):
//
//   Productor (catalogo) <--\
//   Cultivo   (catalogo) <---+-- Recepcion (kilos_recibidos)
//                                    ^
//                                    | relation "recepcion"
//                                 Empaque (kilos_empacados, kilos_merma,
//                                          clasificacion)
//                                    |
//                                    | relation "embarque" (opcional -
//                                    | se llena al despachar el pallet)
//                                    v
//                                Embarque (destino_mercado)
//
// Los campos "relation" usan relationEntity (HU-ERD-74) - sin esto el picker
// de DynamicRelationField.vue no sabe en que entidad buscar, y la ficha de
// detalle de la entidad destino no calcularia la relacion inversa (ej. ver
// desde una Recepcion todos los Empaques que salieron de ella).
//
// "Rendimiento" (kilos recibidos vs empacados vs embarcados, por mercado) NO
// es parte de este seed: es un reporte que se construye sobre estos datos ya
// capturados (dashboard/OLAP), fuera del alcance de "capturar los datos" que
// pidio el usuario en este mensaje - ver nota final en
// DOCS/Flujo_Recepcion_Empaque_Embarque.md.

import postgres from 'postgres'

const connectionString =
  process.env.APP_DATABASE_URL ||
  process.env.DATABASE_URL ||
  'postgresql://erp_app:changeme_app@localhost:5433/erp_dinamico'

const tenantId = process.argv[2]

if (!tenantId) {
  console.error('Uso: node scripts/seedEmpaque.mjs <tenantId>')
  process.exit(1)
}

const entityDefs = [
  {
    slug: 'productores',
    name: 'Productores',
    icon: 'Contact',
    // ERD-86: catalogo de referencia (se consulta al capturar una Recepcion,
    // no se crea a diario) - ver comentario largo en server/db/schema.ts.
    moduleKind: 'dimension',
    fields: [
      { name: 'nombre', label: 'Nombre', dataType: 'text', isRequired: true, validationRules: { maxLength: 150 } },
      { name: 'identificacion', label: 'Identificación fiscal', dataType: 'text', isRequired: false, validationRules: { maxLength: 40 } },
      { name: 'telefono', label: 'Teléfono', dataType: 'text', isRequired: false, validationRules: { maxLength: 20 } }
    ]
  },
  {
    slug: 'cultivos',
    name: 'Cultivos',
    icon: 'Sprout',
    // ERD-86: catalogo de referencia, mismo motivo que 'productores' arriba.
    moduleKind: 'dimension',
    fields: [
      { name: 'nombre', label: 'Nombre', dataType: 'text', isRequired: true, validationRules: { maxLength: 100 } },
      { name: 'variedad', label: 'Variedad', dataType: 'text', isRequired: false, validationRules: { maxLength: 100 } }
    ]
  },
  {
    slug: 'recepciones',
    name: 'Recepciones',
    icon: 'Truck',
    fields: [
      { name: 'fecha', label: 'Fecha', dataType: 'date', isRequired: true, validationRules: {} },
      { name: 'productor', label: 'Productor', dataType: 'relation', isRequired: true, validationRules: { relationEntity: 'productores' } },
      { name: 'cultivo', label: 'Cultivo', dataType: 'relation', isRequired: true, validationRules: { relationEntity: 'cultivos' } },
      { name: 'folio', label: 'Folio de campo', dataType: 'text', isRequired: false, validationRules: { maxLength: 40 } },
      { name: 'kilos_recibidos', label: 'Kilos recibidos', dataType: 'number', isRequired: true, validationRules: { min: 0 } },
      { name: 'observaciones', label: 'Observaciones', dataType: 'text', isRequired: false, validationRules: { maxLength: 300 } }
    ]
  },
  {
    slug: 'empaques',
    name: 'Empaques',
    icon: 'PackageCheck',
    fields: [
      { name: 'fecha', label: 'Fecha', dataType: 'date', isRequired: true, validationRules: {} },
      { name: 'recepcion', label: 'Recepción de origen', dataType: 'relation', isRequired: true, validationRules: { relationEntity: 'recepciones' } },
      {
        name: 'clasificacion',
        label: 'Clasificación',
        dataType: 'select',
        isRequired: true,
        validationRules: {
          options: [
            { value: 'primera', label: 'Primera', color: 'success' },
            { value: 'segunda', label: 'Segunda', color: 'warning' },
            { value: 'industrial', label: 'Industrial', color: 'blue' },
            { value: 'descarte', label: 'Descarte', color: 'error' }
          ]
        }
      },
      { name: 'folio_pallet', label: 'Folio de pallet', dataType: 'text', isRequired: false, validationRules: { maxLength: 40 } },
      { name: 'kilos_empacados', label: 'Kilos empacados', dataType: 'number', isRequired: true, validationRules: { min: 0 } },
      { name: 'kilos_merma', label: 'Kilos de merma', dataType: 'number', isRequired: false, validationRules: { min: 0 } },
      { name: 'embarque', label: 'Embarque', dataType: 'relation', isRequired: false, validationRules: { relationEntity: 'embarques' } }
    ]
  },
  {
    slug: 'embarques',
    name: 'Embarques',
    icon: 'Ship',
    fields: [
      { name: 'fecha', label: 'Fecha', dataType: 'date', isRequired: true, validationRules: {} },
      {
        name: 'destino_mercado',
        label: 'Destino / mercado',
        dataType: 'select',
        isRequired: true,
        validationRules: {
          options: [
            { value: 'nacional', label: 'Nacional', color: 'success' },
            { value: 'estados_unidos', label: 'Estados Unidos', color: 'blue' },
            { value: 'europa', label: 'Europa', color: 'purple' },
            { value: 'asia', label: 'Asia', color: 'pink' },
            { value: 'otro', label: 'Otro', color: 'neutral' }
          ]
        }
      },
      { name: 'cliente', label: 'Cliente', dataType: 'text', isRequired: false, validationRules: { maxLength: 150 } },
      { name: 'folio_guia', label: 'Folio de guía', dataType: 'text', isRequired: false, validationRules: { maxLength: 40 } },
      { name: 'transportista', label: 'Transportista', dataType: 'text', isRequired: false, validationRules: { maxLength: 100 } }
    ]
  }
]

const sql = postgres(connectionString)

// Mismo motivo que scripts/seed.mjs para guardarlo afuera del begin(): evita
// el quirk de set_config(is_local=true) + reconsulta post-transaccion
// documentado en HU-ERD-29 (test/integration/rlsTenantIsolation.test.ts).
let adminRoleFound = false

try {
  await sql.begin(async (tx) => {
    await tx`select set_config('app.tenant_id', ${tenantId}, true)`

    const [adminRole] = await tx`
      select id from roles where tenant_id = ${tenantId} and is_system = true limit 1
    `
    adminRoleFound = Boolean(adminRole)

    for (const def of entityDefs) {
      // ERD-86: def.moduleKind ?? 'hecho' - recepciones/empaques/embarques no
      // lo declaran (son transaccionales, el default de la columna ya es
      // 'hecho'), solo productores/cultivos lo fuerzan a 'dimension'.
      await tx`
        insert into entities (tenant_id, name, slug, icon, module_kind)
        values (${tenantId}, ${def.name}, ${def.slug}, ${def.icon}, ${def.moduleKind ?? 'hecho'})
        on conflict (tenant_id, slug) do nothing
      `
      const [entity] = await tx`
        select id from entities where tenant_id = ${tenantId} and slug = ${def.slug}
      `

      let created = 0
      for (let i = 0; i < def.fields.length; i++) {
        const field = def.fields[i]
        const result = await tx`
          insert into entity_fields (entity_id, name, label, data_type, validation_rules, is_required, sort_order)
          values (${entity.id}, ${field.name}, ${field.label}, ${field.dataType}, ${sql.json(field.validationRules)}, ${field.isRequired}, ${i})
          on conflict (entity_id, name) do nothing
          returning id
        `
        created += result.length
      }

      if (adminRole) {
        await tx`
          insert into role_entity_permissions (role_id, entity_id, can_read, can_create, can_update, can_delete)
          values (${adminRole.id}, ${entity.id}, true, true, true, true)
          on conflict (role_id, entity_id) do nothing
        `
      }

      console.log(`${def.name} (${def.slug}): entidad OK, ${created}/${def.fields.length} campos nuevos${adminRole ? ', permiso admin OK' : ''}`)
    }
  })

  if (!adminRoleFound) {
    console.log('')
    console.log('Aviso: no se encontro un rol de sistema (isSystem=true) para este tenant - las entidades')
    console.log('quedaron creadas pero sin permisos otorgados a ningun rol todavia.')
  }

  console.log('')
  console.log('Seed completo: Productores, Cultivos, Recepciones, Empaques, Embarques.')
} finally {
  await sql.end()
}
