import 'dotenv/config'
import postgres from 'postgres'
import { randomUUID } from 'node:crypto'

// Crea el primer paquete funcional de Nóminas para cada organización.
// Es idempotente: se puede ejecutar varias veces sin duplicar módulos, campos
// ni el área en la navegación.
const sql = postgres(process.env.DATABASE_URL)

const definitions = [
  {
    name: 'Empleados', slug: 'empleados', singular: 'Empleado', icon: 'UsersRound',
    description: 'Catálogo de personas que reciben pagos de nómina.',
    fields: [
      ['codigo', 'Código', 'text', true],
      ['nombre_completo', 'Nombre completo', 'text', true],
      ['puesto', 'Puesto', 'text', false],
      ['fecha_ingreso', 'Fecha de ingreso', 'date', false],
      ['salario_base', 'Salario base', 'currency', false],
      ['estatus', 'Estatus', 'select', true]
    ]
  },
  {
    name: 'Periodos de nómina', slug: 'periodos_nomina', singular: 'Periodo de nómina', icon: 'CalendarRange',
    description: 'Periodos de pago y control del proceso de nómina.',
    fields: [
      ['nombre', 'Nombre del periodo', 'text', true],
      ['fecha_inicio', 'Fecha de inicio', 'date', true],
      ['fecha_fin', 'Fecha de fin', 'date', true],
      ['fecha_pago', 'Fecha de pago', 'date', false],
      ['tipo_periodo', 'Tipo de periodo', 'select', true],
      ['estatus', 'Estatus', 'select', true]
    ]
  }
]

const employeeSeed = [
  ['EMP-001', 'Ana López', 'Coordinadora de nómina', '2024-01-15', 18500, 'activo'],
  ['EMP-002', 'Brenda García', 'Analista contable', '2024-03-04', 16200, 'activo'],
  ['EMP-003', 'Carlos Hernández', 'Supervisor de operaciones', '2023-08-21', 22000, 'activo'],
  ['EMP-004', 'Daniela Torres', 'Auxiliar administrativo', '2025-02-10', 11500, 'activo'],
  ['EMP-005', 'Eduardo Ramírez', 'Encargado de almacén', '2023-11-06', 14800, 'activo'],
  ['EMP-006', 'Fernanda Sánchez', 'Analista de compras', '2024-06-17', 15600, 'activo'],
  ['EMP-007', 'Gabriel Flores', 'Operador', '2025-01-20', 9800, 'activo'],
  ['EMP-008', 'Hugo Martínez', 'Operador', '2025-04-07', 9800, 'activo'],
  ['EMP-009', 'Irene Castillo', 'Recursos humanos', '2024-09-02', 17400, 'activo'],
  ['EMP-010', 'Jorge Mendoza', 'Chofer', '2023-05-12', 13200, 'activo'],
  ['EMP-011', 'Karla Navarro', 'Operadora', '2025-05-19', 9800, 'activo'],
  ['EMP-012', 'Luis Ortega', 'Técnico de calidad', '2024-10-28', 14300, 'activo'],
  ['EMP-013', 'Mariana Cruz', 'Supervisora de empaque', '2023-07-03', 20500, 'activo'],
  ['EMP-014', 'Nicolás Silva', 'Operador', '2025-06-02', 9800, 'activo'],
  ['EMP-015', 'Olga Reyes', 'Compras', '2024-02-26', 15800, 'activo'],
  ['EMP-016', 'Pablo Ruiz', 'Mantenimiento', '2023-12-11', 12700, 'activo'],
  ['EMP-017', 'Rosa Vargas', 'Almacén', '2025-03-17', 11900, 'activo'],
  ['EMP-018', 'Sergio Molina', 'Operador', '2025-07-14', 9800, 'activo'],
  ['EMP-019', 'Teresa Ríos', 'Administración', '2024-05-06', 14100, 'activo'],
  ['EMP-020', 'Ulises Ponce', 'Chofer', '2024-11-18', 13200, 'activo'],
  ['EMP-021', 'Valeria Campos', 'Analista de nómina', '2025-08-04', 15400, 'activo'],
  ['EMP-022', 'Wendy Mora', 'Operadora', '2025-09-01', 9800, 'activo'],
  ['EMP-023', 'Ximena Fuentes', 'Calidad', '2024-07-22', 13600, 'activo'],
  ['EMP-024', 'Yael Domínguez', 'Operador', '2026-01-12', 9800, 'activo']
]

const defaultRules = (name, dataType) => {
  if (dataType !== 'select') return {}
  if (name === 'estatus') return {
    options: [
      { value: 'activo', label: 'Activo' },
      { value: 'inactivo', label: 'Inactivo' },
      { value: 'borrador', label: 'Borrador' },
      { value: 'en_proceso', label: 'En proceso' },
      { value: 'pagado', label: 'Pagado' },
      { value: 'cerrado', label: 'Cerrado' }
    ]
  }
  return { options: [
    { value: 'semanal', label: 'Semanal' },
    { value: 'quincenal', label: 'Quincenal' },
    { value: 'mensual', label: 'Mensual' }
  ] }
}

try {
  const tenants = await sql`select id from tenants order by created_at`
  for (const tenant of tenants) {
    await sql.begin(async tx => {
      const entityIds = []
      const [admin] = await tx`select id from roles where tenant_id = ${tenant.id} and is_system = true limit 1`

      for (const definition of definitions) {
        let [entity] = await tx`select id from entities where tenant_id = ${tenant.id} and slug = ${definition.slug} limit 1`
        if (!entity) {
          ;[entity] = await tx`
            insert into entities (tenant_id, name, slug, description, icon, singular_name, module_kind)
            values (${tenant.id}, ${definition.name}, ${definition.slug}, ${definition.description}, ${definition.icon}, ${definition.singular}, 'hecho')
            returning id
          `
        }
        entityIds.push(entity.id)

        for (let index = 0; index < definition.fields.length; index++) {
          const [name, label, dataType, isRequired] = definition.fields[index]
          const existing = await tx`select id from entity_fields where entity_id = ${entity.id} and name = ${name} limit 1`
          if (!existing.length) {
            await tx`
              insert into entity_fields (entity_id, name, label, data_type, validation_rules, is_required, sort_order)
              values (${entity.id}, ${name}, ${label}, ${dataType}, ${JSON.stringify(defaultRules(name, dataType))}::jsonb, ${isRequired}, ${index})
            `
          } else if (dataType === 'select') {
            await tx`
              update entity_fields
              set validation_rules = ${JSON.stringify(defaultRules(name, dataType))}::jsonb, updated_at = now()
              where id = ${existing[0].id}
            `
          }
        }

        if (admin) {
          await tx`
            insert into role_entity_permissions (role_id, entity_id, can_read, can_create, can_update, can_delete, show_in_menu)
            values (${admin.id}, ${entity.id}, true, true, true, true, true)
            on conflict (role_id, entity_id) do update set can_read = true, can_create = true, can_update = true, can_delete = true, show_in_menu = true
          `
        }
      }

      const employeeEntity = await tx`select id from entities where tenant_id = ${tenant.id} and slug = 'empleados' limit 1`
      const periodsEntity = await tx`select id from entities where tenant_id = ${tenant.id} and slug = 'periodos_nomina' limit 1`
      if (employeeEntity?.[0] && periodsEntity?.[0]) {
        for (const [code, fullName, position, startDate, salary, status] of employeeSeed) {
          const exists = await tx`select id from records where tenant_id = ${tenant.id} and entity_id = ${employeeEntity[0].id} and custom_data->>'codigo' = ${code} and deleted_at is null limit 1`
          if (!exists.length) {
            await tx`
              insert into records (entity_id, tenant_id, custom_data)
              values (${employeeEntity[0].id}, ${tenant.id}, ${JSON.stringify({ codigo: code, nombre_completo: fullName, puesto: position, fecha_ingreso: startDate, salario_base: salary, estatus: status })}::jsonb)
            `
          }
        }

        const today = new Date()
        for (let index = 0; index < 12; index++) {
          const end = new Date(today)
          end.setDate(today.getDate() - index * 15)
          const start = new Date(end)
          start.setDate(end.getDate() - 14)
          const iso = value => value.toISOString().slice(0, 10)
          const name = `Quincena ${String(12 - index).padStart(2, '0')} · ${end.getFullYear()}`
          const exists = await tx`select id from records where tenant_id = ${tenant.id} and entity_id = ${periodsEntity[0].id} and custom_data->>'nombre' = ${name} and deleted_at is null limit 1`
          if (!exists.length) {
            await tx`
              insert into records (entity_id, tenant_id, custom_data)
              values (${periodsEntity[0].id}, ${tenant.id}, ${JSON.stringify({ nombre: name, fecha_inicio: iso(start), fecha_fin: iso(end), fecha_pago: iso(end), tipo_periodo: 'quincenal', estatus: index === 0 ? 'en_proceso' : 'pagado' })}::jsonb)
            `
          }
        }
      }

      const [tenantRow] = await tx`select navigation_layout from tenants where id = ${tenant.id} for update`
      const rawLayout = typeof tenantRow?.navigation_layout === 'string'
        ? JSON.parse(tenantRow.navigation_layout)
        : tenantRow?.navigation_layout
      const layout = rawLayout && Array.isArray(rawLayout.groups)
        ? structuredClone(rawLayout)
        : { groups: [] }
      let group = layout.groups.find(item => item.name === 'Nóminas' && !item.parentId)
      if (!group) {
        group = { id: randomUUID(), name: 'Nóminas', icon: 'UsersRound', parentId: null, entityIds: [] }
        layout.groups.push(group)
      }
      for (const id of entityIds) {
        for (const item of layout.groups) item.entityIds = (item.entityIds || []).filter(entityId => entityId !== id)
        group.entityIds.push(id)
      }
      await tx`update tenants set navigation_layout = ${tx.json(layout)}, navigation_revision = navigation_revision + 1, updated_at = now() where id = ${tenant.id}`
    })
    console.log(`Nóminas configurado para ${tenant.id}`)
  }
} finally {
  await sql.end()
}
