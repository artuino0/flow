import type { AgentTenantModule } from '../../utils/agentTenantCatalog'
export const travelCatalog: AgentTenantModule[] = [
 ['Aplicaciones de cobro', 'aplicaciones_cobro', 'hecho'], ['Citas', 'citas', 'hecho'],
 ['Cobros de clientes', 'cobros_cliente', 'hecho'], ['Cuentas por cobrar', 'cuentas_por_cobrar', 'hecho'],
 ['Clientes', 'clientes', 'dimension'], ['Condiciones de pago', 'condiciones_pago', 'dimension'],
 ['Cuentas bancarias', 'cuentas_bancarias', 'dimension'], ['Métodos de pago', 'metodos_pago', 'dimension'],
 ['Asesores', 'profesionales', 'dimension'], ['Servicios', 'servicios', 'dimension'], ['Sucursales', 'sucursales', 'dimension']
].map(([name, slug, moduleKind]) => ({ id: slug!, name: name!, slug: slug!, moduleKind: moduleKind!, singularName: '', description: '', fieldLabels: [], canCreate: true }))
