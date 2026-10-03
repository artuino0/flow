import { applyBlueprint } from '~/server/utils/blueprint/apply'
import type { Blueprint } from '~/server/utils/blueprint/schema'
import { and, eq, isNull } from 'drizzle-orm'
import { createError } from 'h3'
import { db, withTenant } from '~/server/db'
import { entities, entityFields } from '~/server/db/schema'
import { isAgendaBase } from '~/utils/agendaBase'

export type AgendaClientChoice = { mode: 'create' } | { mode: 'link'; entityId: string }

export async function agendaClientTarget(tx: typeof db, tenantId: string, entityId: string) {
  const [entity] = await tx.select().from(entities).where(and(eq(entities.id, entityId), eq(entities.tenantId, tenantId), eq(entities.isActive, true), isNull(entities.deletedAt))).limit(1)
  if (!entity || isAgendaBase(entity)) throw createError({ statusCode: 422, statusMessage: 'Elige un módulo activo de esta organización para los clientes.' })
  const [text] = await tx.select({ name: entityFields.name }).from(entityFields).where(and(eq(entityFields.entityId, entity.id), eq(entityFields.dataType, 'text'))).limit(1)
  if (!text) throw createError({ statusCode: 422, statusMessage: 'El módulo de clientes debe tener al menos un campo de texto para mostrar.' })
  return entity
}

export function agendaBlueprintForClient(targetSlug?: string): Blueprint {
  const blueprint = structuredClone(agendaBlueprint)
  if (!targetSlug) return blueprint
  blueprint.modules = blueprint.modules.filter(module => module.ref !== 'agenda-clientes')
  blueprint.modules.find(module => module.ref === 'agenda-citas')!.fields.find(field => field.name === 'cliente')!.validationRules = { relationEntity: targetSlug }
  for (const role of blueprint.roles ?? []) for (const permission of role.permissions) if (permission.moduleRef === 'agenda-clientes') permission.moduleRef = targetSlug
  return blueprint
}

const statusOptions = [
  ['agendada', 'Agendada'], ['confirmada', 'Confirmada'], ['en_curso', 'En curso'],
  ['terminada', 'Terminada'], ['cancelada', 'Cancelada'], ['no_asistio', 'No asistió']
].map(([value, label]) => ({ value, label }))

export const agendaBlueprint: Blueprint = {
  version: 1,
  summary: 'Agenda de citas, servicios, clientes, recursos y personal del sistema',
  associations: [],
  modules: [
    {
      ref: 'agenda-clientes', action: 'create', kind: 'dimension', name: 'Clientes', slug: 'agenda-clientes',
      fields: [
        { name: 'nombre', label: 'Nombre', dataType: 'text', required: true },
        { name: 'telefono', label: 'Teléfono', dataType: 'text' },
        { name: 'correo', label: 'Correo', dataType: 'text' }
      ]
    },
    {
      ref: 'agenda-servicios', action: 'create', kind: 'dimension', name: 'Servicios', slug: 'agenda-servicios',
      fields: [
        { name: 'nombre', label: 'Servicio', dataType: 'text', required: true },
        { name: 'duracion_minutos', label: 'Duración en minutos', dataType: 'number', validationRules: { min: 1, integer: true } },
        { name: 'precio', label: 'Precio', dataType: 'currency' }
      ]
    },
    {
      ref: 'agenda-recursos', action: 'create', kind: 'dimension', name: 'Recursos', slug: 'agenda-recursos',
      fields: [
        { name: 'nombre', label: 'Recurso', dataType: 'text', required: true },
        { name: 'descripcion', label: 'Descripción', dataType: 'text' },
        { name: 'activo', label: 'Activo', dataType: 'boolean' }
      ]
    },
    {
      ref: 'agenda-citas', action: 'create', kind: 'hecho', name: 'Citas', singularName: 'Cita', slug: 'agenda-citas',
      fields: [
        { name: 'asunto', label: 'Asunto', dataType: 'text', required: true },
        { name: 'cliente', label: 'Cliente', dataType: 'relation', required: true, validationRules: { relationEntity: 'agenda-clientes' } },
        { name: 'fecha', label: 'Fecha', dataType: 'date', required: true },
        { name: 'hora', label: 'Hora', dataType: 'text', required: true },
        { name: 'duracion_minutos', label: 'Duración en minutos', dataType: 'number', validationRules: { min: 1, integer: true } },
        { name: 'personal', label: 'Personal que atiende', dataType: 'user', required: true, isOwnerField: true, validationRules: { roles: ['Personal'] } },
        { name: 'recurso', label: 'Recurso', dataType: 'relation', validationRules: { relationEntity: 'agenda-recursos' } },
        { name: 'estado', label: 'Estado', dataType: 'select', required: true, validationRules: { options: statusOptions } },
        { name: 'notas', label: 'Notas', dataType: 'text' }
      ],
      lines: [{ childRef: 'agenda-servicios-cita', relationField: 'cita', totals: ['importe'] }],
      calendarConfig: { enabled: true, startDateField: 'fecha', startTimeField: 'hora', durationField: 'duracion_minutos', endField: null, titleField: 'asunto', colorField: 'estado', groupByField: 'personal', defaultView: 'day' }
    },
    {
      ref: 'agenda-servicios-cita', action: 'create', kind: 'hecho', name: 'Servicios de la cita', singularName: 'Servicio de la cita', slug: 'agenda-servicios-cita',
      fields: [
        { name: 'cita', label: 'Cita', dataType: 'relation', required: true, validationRules: { relationEntity: 'agenda-citas' } },
        { name: 'servicio', label: 'Servicio', dataType: 'relation', required: true, validationRules: { relationEntity: 'agenda-servicios' } },
        { name: 'importe', label: 'Importe', dataType: 'currency', required: true },
        { name: 'observaciones', label: 'Observaciones', dataType: 'text' }
      ]
    }
  ],
  roles: [
    { name: 'Recepción', permissions: ['agenda-clientes', 'agenda-servicios', 'agenda-recursos', 'agenda-citas', 'agenda-servicios-cita'].map(moduleRef => ({ moduleRef, visibility: 'all' as const, canRead: true, canCreate: true, canUpdate: true, canDelete: false })) },
    { name: 'Personal', permissions: [
      ...['agenda-clientes', 'agenda-servicios', 'agenda-recursos'].map(moduleRef => ({ moduleRef, visibility: 'all' as const, canRead: true, canCreate: false, canUpdate: false, canDelete: false })),
      ...['agenda-citas', 'agenda-servicios-cita'].map(moduleRef => ({ moduleRef, visibility: 'own' as const, canRead: true, canCreate: true, canUpdate: true, canDelete: false }))
    ] }
  ]
}

export async function installAgendaTemplate(tenantId: string, choice: AgendaClientChoice = { mode: 'create' }) {
  const installed = await withTenant(tenantId, tx => tx.select({ id: entities.id, slug: entities.slug, templateKey: entities.templateKey }).from(entities).where(and(eq(entities.tenantId, tenantId), eq(entities.slug, 'agenda-citas'))).limit(1))
  if (installed[0] && isAgendaBase(installed[0])) return { modules: installed, fields: [], associations: [], layouts: [], workflows: [], merges: [] }
  const target = choice.mode === 'link' ? await withTenant(tenantId, tx => agendaClientTarget(tx, tenantId, choice.entityId)) : undefined
  const blueprint = agendaBlueprintForClient(target?.slug)
  const collisions = await withTenant(tenantId, tx => tx.select({ slug: entities.slug }).from(entities).where(eq(entities.tenantId, tenantId)))
  if (blueprint.modules.some(module => collisions.some(existing => existing.slug === module.slug))) throw createError({ statusCode: 422, statusMessage: 'Ya existe un módulo con un identificador reservado de Agenda. Conservamos tus módulos; cambia ese identificador antes de instalar Citas base.' })
  const result = await applyBlueprint(tenantId, null, blueprint, 'system:agenda:v1', 'agenda')
  return result
}
