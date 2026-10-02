import { Blocks, Braces, Calendar, CircleDollarSign, Hash, KeyRound, Link2, List, ListChecks, ListOrdered, Paperclip, Table2, ToggleLeft, Type as TypeIcon, UserRound } from '@lucide/vue'

export const TYPE_BADGE: Record<string, { icon: typeof TypeIcon; bg: string; text: string; label: string }> = {
  text: { icon: TypeIcon, bg: 'bg-brand-neutral-bg', text: 'text-brand-neutral-text', label: 'Texto' },
  number: { icon: Hash, bg: 'bg-brand-success-bg', text: 'text-brand-success-text', label: 'Número' },
  currency: { icon: CircleDollarSign, bg: 'bg-brand-success-bg', text: 'text-brand-success-text', label: 'Monto' },
  boolean: { icon: ToggleLeft, bg: 'bg-brand-warning-bg', text: 'text-brand-warning-text', label: 'Booleano' },
  date: { icon: Calendar, bg: 'bg-brand-pink-bg', text: 'text-brand-pink-text', label: 'Fecha' },
  json: { icon: Braces, bg: 'bg-brand-purple-bg', text: 'text-brand-purple-text', label: 'JSON' },
  relation: { icon: Link2, bg: 'bg-brand-blue-bg', text: 'text-brand-blue', label: 'Relación' },
  user: { icon: UserRound, bg: 'bg-brand-blue-bg', text: 'text-brand-blue', label: 'Usuario' },
  // HU-ERD-71: sin badge propio en el .pen para estos 3 tipos (el diseño de
  // la lista de campos es anterior a HU-ERD-68) - se sigue el mismo patrón
  // que los demás (icono + par bg/text de marca), usando los tokens
  // info-* (sin usar todavía en ningún otro badge) para Select/Multiselect.
  select: { icon: List, bg: 'bg-brand-info-bg', text: 'text-brand-info-text', label: 'Select' },
  multiselect: { icon: ListChecks, bg: 'bg-brand-info-bg', text: 'text-brand-info-text', label: 'Multiselect' },
  tabla: { icon: Table2, bg: 'bg-brand-neutral-bg', text: 'text-brand-neutral-text', label: 'Tabla' },
  // HU-ERD-78: sin badge propio en el .pen (tipo nuevo, sin mock) - mismo
  // criterio que select/multiselect/tabla de arriba.
  file: { icon: Paperclip, bg: 'bg-brand-indigo-bg', text: 'text-brand-indigo-text', label: 'Archivo' },
  // Reportado por el usuario (2026-09-01): la fila del campo "id" (ver
  // "Reservado" en vez de editar/eliminar, mas abajo) mostraba el badge de su
  // dataType real guardado (ej. "# Número", si se creo asi antes de bloquear
  // su edicion) - conceptualmente "id" siempre es un uuid, mas alla de que
  // dataType haya quedado guardado. badgeForField() de abajo fuerza este tipo
  // para esa fila puntual, sin tocar el dataType real en la base.
  uuid: { icon: KeyRound, bg: 'bg-brand-gold-bg', text: 'text-brand-gold-text', label: 'UUID' },
  // Pedido directo del usuario (2026-09-04): "Incremental" - mismo par de
  // color que "uuid" de arriba (dorado): ambos son, conceptualmente,
  // identificadores autogenerados de solo lectura - se diferencian por icono
  // (ListOrdered en vez de KeyRound), mismo criterio de reuso de color ya
  // establecido entre select/multiselect (ambos "info") y text/tabla (ambos
  // "neutral").
  incremental: { icon: ListOrdered, bg: 'bg-brand-gold-bg', text: 'text-brand-gold-text', label: 'Incremental' }
}
export function badgeFor(dataType: string) {
  return TYPE_BADGE[dataType] ?? { icon: Blocks, bg: 'bg-brand-neutral-bg', text: 'text-brand-neutral-text', label: dataType }
}
