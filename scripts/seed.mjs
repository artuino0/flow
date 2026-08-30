// Seed condicional de metadatos (HU-ERD-25): crea las entities/entity_fields
// base de Clientes, Empresas y Empleados para un tenant ya existente, con
// campos adicionales segun el perfil de despliegue (ej. sector agricola).
// No es parte del build ni corre automaticamente - se invoca a mano por
// tenant, tipicamente una vez, al dar de alta un cliente nuevo.
//
// Uso:
//   node scripts/seed.mjs <tenantId> [perfil]
//
// perfil: "generico" (default) | "agro"
//
// Idempotente: entities usa el unique (tenant_id, slug) y entity_fields usa
// el unique (entity_id, name) - ambos con ON CONFLICT DO NOTHING, asi que
// correrlo mas de una vez no duplica filas. No actualiza campos existentes
// si ya estaban creados con otra definicion (fuera del alcance de esta HU:
// solo evita duplicar, no reconcilia cambios de metadatos).
//
// Alcance de esta HU: solo entities/entity_fields. Si el tenant ya tiene un
// rol "Administrador" (roles.isSystem = true, convencion de HU-ERD-61), se le
// otorga permiso total (CRUD) sobre las entidades sembradas para que el
// modulo sea usable de inmediato via el RBAC existente (HU-ERD-15/16) - sin
// esto, las entidades quedarian creadas pero inaccesibles para cualquier rol.

import postgres from 'postgres'

const connectionString =
  process.env.APP_DATABASE_URL ||
  process.env.DATABASE_URL ||
  'postgresql://erp_app:changeme_app@localhost:5433/erp_dinamico'

const tenantId = process.argv[2]
const perfil = process.argv[3] || 'generico'

if (!tenantId) {
  console.error('Uso: node scripts/seed.mjs <tenantId> [perfil]')
  console.error('perfil: generico (default) | agro')
  process.exit(1)
}
if (!['generico', 'agro'].includes(perfil)) {
  console.error(`Perfil desconocido: "${perfil}". Valores validos: generico, agro`)
  process.exit(1)
}

// RFC_REGEX identico a server/utils/tenantFiscal.ts (HU-ERD-61), reusado aca
// para el campo "rfc" de Empresas - mismo formato en todo el sistema.
const RFC_REGEX_SRC = '^[A-ZÑ&]{3,4}\\d{6}[A-Z0-9]{3}$'
const EMAIL_REGEX_SRC = '^[^@]+@[^@]+\\.[^@]+$'

// Definicion base (perfil "generico") de las 3 entidades del modulo
// CRM/Directorio Central, mas los campos extra que agrega el perfil "agro".
const entityDefs = [
  {
    slug: 'clientes',
    name: 'Clientes',
    fields: [
      { name: 'nombre', label: 'Nombre', dataType: 'text', isRequired: true, validationRules: { maxLength: 120 } },
      { name: 'email', label: 'Correo', dataType: 'text', isRequired: false, validationRules: { pattern: EMAIL_REGEX_SRC } },
      { name: 'telefono', label: 'Telefono', dataType: 'text', isRequired: false, validationRules: { maxLength: 20 } },
      { name: 'direccion', label: 'Direccion', dataType: 'text', isRequired: false, validationRules: { maxLength: 200 } }
    ],
    agroFields: [
      {
        name: 'tipo_cliente',
        label: 'Tipo de cliente',
        dataType: 'text',
        isRequired: true,
        validationRules: { enum: ['comprador', 'proveedor', 'ambos'] }
      }
    ]
  },
  {
    slug: 'empresas',
    name: 'Empresas',
    fields: [
      { name: 'razon_social', label: 'Razon social', dataType: 'text', isRequired: true, validationRules: { maxLength: 150 } },
      { name: 'rfc', label: 'RFC', dataType: 'text', isRequired: false, validationRules: { pattern: RFC_REGEX_SRC } },
      { name: 'telefono', label: 'Telefono', dataType: 'text', isRequired: false, validationRules: { maxLength: 20 } },
      { name: 'direccion', label: 'Direccion', dataType: 'text', isRequired: false, validationRules: { maxLength: 200 } }
    ],
    agroFields: [
      { name: 'hectareas', label: 'Hectareas', dataType: 'number', isRequired: false, validationRules: { min: 0 } },
      { name: 'tipo_produccion', label: 'Tipo de produccion', dataType: 'text', isRequired: false, validationRules: { maxLength: 100 } }
    ]
  },
  {
    slug: 'empleados',
    name: 'Empleados',
    fields: [
      { name: 'nombre_completo', label: 'Nombre completo', dataType: 'text', isRequired: true, validationRules: { maxLength: 150 } },
      { name: 'puesto', label: 'Puesto', dataType: 'text', isRequired: false, validationRules: { maxLength: 100 } },
      { name: 'email', label: 'Correo', dataType: 'text', isRequired: false, validationRules: { pattern: EMAIL_REGEX_SRC } },
      { name: 'fecha_ingreso', label: 'Fecha de ingreso', dataType: 'date', isRequired: false, validationRules: {} }
    ],
    agroFields: [
      { name: 'trabaja_en_campo', label: 'Trabaja en campo', dataType: 'boolean', isRequired: false, validationRules: {} }
    ]
  }
]

const sql = postgres(connectionString)

try {
  await sql.begin(async (tx) => {
    // Mismo mecanismo que withTenant() (server/db/index.ts): habilita las
    // politicas RLS de "entities" (HU-ERD-12) para este tenant.
    await tx`select set_config('app.tenant_id', ${tenantId}, true)`

    const [adminRole] = await tx`
      select id from roles where tenant_id = ${tenantId} and is_system = true limit 1
    `

    for (const def of entityDefs) {
      const fields = perfil === 'agro' ? [...def.fields, ...def.agroFields] : def.fields

      await tx`
        insert into entities (tenant_id, name, slug)
        values (${tenantId}, ${def.name}, ${def.slug})
        on conflict (tenant_id, slug) do nothing
      `
      const [entity] = await tx`
        select id from entities where tenant_id = ${tenantId} and slug = ${def.slug}
      `

      let created = 0
      for (const field of fields) {
        const result = await tx`
          insert into entity_fields (entity_id, name, label, data_type, validation_rules, is_required)
          values (${entity.id}, ${field.name}, ${field.label}, ${field.dataType}, ${sql.json(field.validationRules)}, ${field.isRequired})
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

      console.log(`${def.name} (${def.slug}): entidad OK, ${created}/${fields.length} campos nuevos${adminRole ? ', permiso admin OK' : ''}`)
    }
  })

  if (!(await sql`select id from roles where tenant_id = ${tenantId} and is_system = true limit 1`).length) {
    console.log('')
    console.log('Aviso: no se encontro un rol de sistema (isSystem=true) para este tenant - las entidades')
    console.log('quedaron creadas pero sin permisos otorgados a ningun rol todavia.')
  }

  console.log('')
  console.log(`Seed completo. Perfil: ${perfil}`)
} finally {
  await sql.end()
}
