import { applyBlueprint } from '~/server/utils/blueprint/apply'
import type { Blueprint } from '~/server/utils/blueprint/schema'

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

export async function installAgendaTemplate(tenantId: string) {
  const result = await applyBlueprint(tenantId, null, agendaBlueprint, 'system:agenda:v1', 'agenda')
  return result
}
