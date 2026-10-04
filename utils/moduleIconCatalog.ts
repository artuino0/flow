// Pedido directo del usuario (2026-09-01): primero un selector curado de 24
// iconos para el modulo; el mismo dia, feedback directo sobre ese primer
// selector - "cuando decia selector de iconos me imaginaba que me darias un
// componente como el que tienes ya creado pero con todos los iconos y un
// buscador" - asi que este archivo ya NO cura una lista corta a mano: expone
// el catalogo COMPLETO de @lucide/vue (1781 iconos, uno por glifo unico) via
// el export `icons` del paquete (mismo objeto que arma
// node_modules/@lucide/vue/dist/esm/icons/index.mjs - un componente Vue real
// por nombre canonico PascalCase, sin los alias como "UsersIcon"/"LucideUsers"
// que el paquete tambien exporta para el mismo icono). Las CLAVES guardadas en
// entities.icon son esos mismos nombres PascalCase ("Building2", "UserRound",
// etc.) - ver server/utils/moduleIcons.ts (MODULE_ICON_KEYS), que valida
// exactamente este mismo catalogo del lado del servidor sin importar Vue.
import { Blocks, icons } from '@lucide/vue'
import type { Component } from 'vue'

export interface ModuleIconOption {
  key: string
  label: string
  component: Component
}

// "AArrowDown" -> "A Arrow Down", "Building2" -> "Building 2": separa
// palabras en un nombre PascalCase para que el buscador del picker
// (components/IconPicker.vue) matchee sobre texto legible, no solo sobre el
// nombre pegado. No traduce al espanol (1781 iconos, inviable traducir a
// mano) - es un compromiso deliberado: el buscador es sobre el nombre en
// ingles del icono de lucide, igual que en cualquier explorador de iconos.
function humanize(pascalName: string): string {
  return pascalName
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([A-Za-z])([0-9])/g, '$1 $2')
    .trim()
}

export const MODULE_ICONS: ModuleIconOption[] = Object.entries(icons as Record<string, Component>)
  .map(([key, component]) => ({ key, label: humanize(key), component }))
  .sort((a, b) => a.label.localeCompare(b.label, 'es'))

