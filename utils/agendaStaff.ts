export interface AgendaStaffCandidate {
  tenantId: string; isActive: boolean; roleName: string | null; isSystem: boolean | null; scheduled: boolean
}

/** Elegibilidad para atender; no concede permisos de gestión ni acceso a registros. */
export function isAgendaStaff(person: AgendaStaffCandidate, tenantId: string): boolean {
  return person.tenantId === tenantId && person.isActive && (person.isSystem === true || person.roleName === 'Personal' || person.scheduled)
}
