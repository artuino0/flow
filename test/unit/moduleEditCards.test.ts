import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parse } from '@vue/compiler-sfc'
import type { ElementNode, TemplateChildNode } from '@vue/compiler-core'

function elements(children: TemplateChildNode[]): ElementNode[] {
  return children.flatMap(node => node.type === 1 ? [node, ...elements(node.children)] : [])
}
function nodes(file: string) {
  return elements(parse(readFileSync(file, 'utf8')).descriptor.template!.ast!.children)
}
function attribute(node: ElementNode, name: string) {
  const prop = node.props.find(prop => prop.type === 6 && prop.name === name)
  return prop?.type === 6 ? prop.value?.content ?? '' : ''
}
const pattern = ['flex', 'flex-col', 'rounded-lg', 'border', 'border-brand-border-light', 'bg-brand-surface', 'shadow-[0_1px_3px_0_rgb(var(--brand-shadow)/0.0784313725490196)]']

describe('marco de edición y ayuda junto al título', () => {
  it('el encabezado del listado y los modos de vista pertenecen a una sola card', () => {
    const all = nodes('components/ModuleListLayoutCard.vue')
    const card = all.find(node => pattern.every(token => attribute(node, 'class').split(' ').includes(token)) && elements(node.children).some(child => attribute(child, 'role') === 'tablist'))!
    expect(card).toBeDefined()
    const header = card.children.find(node => node.type === 1 && attribute(node, 'class').includes('border-b')) as ElementNode
    expect(attribute(header, 'class')).toContain('border-brand-border-light p-5')
    const title = elements(header.children).find(node => node.tag === 'h2')!
    expect(title.children.some(node => node.type === 2 && node.content === 'Listado de registros')).toBe(true)
    expect(attribute(title, 'class')).toBe('text-[15px] font-bold text-brand-text')
    expect(elements(header.children).some(node => node.tag === 'slot' && attribute(node, 'name') === 'actions')).toBe(true)
    const views = card.children.find(node => node.type === 1 && attribute(node, 'role') === 'tablist') as ElementNode
    expect(views).toBeDefined()
    expect(attribute(views, 'data-tour')).toBe('edit-list-views')
    for (const token of ['border', 'rounded-lg', 'shadow-[0_1px_3px_0_rgb(var(--brand-shadow)/0.0784313725490196)]']) expect(attribute(views, 'class').split(' ')).not.toContain(token)
    expect(elements(views.children).filter(node => attribute(node, 'role') === 'tab')).toHaveLength(3)
    const wizard = readFileSync('components/ModuleWizard.vue', 'utf8')
    expect(wizard).toContain('<template #actions>')
    expect(wizard).toContain(':data-tour="moduleKind === \'hecho\' ? \'manual-list-save\' : undefined"')
    expect(wizard).toContain('@click="onSaveListLayout"')
  })

  it.each([
    ['info', 'pages/modulos/[id]/editar.vue'], ['fields', 'components/ModuleFieldsCard.vue'],
    ['relations', 'components/ModuleRelationsCard.vue'], ['menu', 'components/ModuleNavigationEditor.vue'],
    ['detail', 'components/ModuleDetailLayoutCard.vue'], ['list', 'components/ModuleListLayoutCard.vue'],
    ['flow', 'components/ModuleStateWorkflowCard.vue'], ['labels', 'components/ModuleLabelEditor.vue'],
    ['api', 'components/ModuleApiDocs.vue']
  ])('incluye el botón de %s junto a su h2 en %s', (tab, file) => {
    const all = nodes(file)
    const help = all.filter(node => node.tag === 'ModuleTourHelpButton' && attribute(node, 'tab') === tab)
    expect(help).toHaveLength(1)
    const titleRow = all.find(node => node.children.includes(help[0]!) && node.children.some(child => child.type === 1 && child.tag === 'h2'))!
    expect(titleRow).toBeDefined()
    expect(attribute(titleRow, 'class')).toBe('flex items-center gap-2')
  })

  it('la ayuda es accesible y usa una sola lógica de lanzamiento', () => {
    const source = readFileSync('components/ModuleTourHelpButton.vue', 'utf8')
    expect(source).toContain('useContextualTourHelp(helpId)')
    expect(source).toContain('type="button"')
    expect(source).toContain(':aria-label="label"')
    expect(source).toContain('Ver recorrido de')
    expect(source).toContain('title="Ver recorrido"')
    expect(source).toContain('v-if="available"')
    expect(source).toContain(':disabled="disabled"')
    expect(source).toContain('focus-visible:outline')
    expect(source).toContain('CircleHelp')
    expect(source).toContain('@click="launch"')
  })

  it('también ofrece la ayuda de Menú en la rama informativa de los catálogos', () => {
    const all = nodes('pages/modulos/[id]/editar.vue')
    const catalogCard = all.find(node => node.tag === 'section' && pattern.every(token => attribute(node, 'class').split(' ').includes(token)) && elements(node.children).some(child => child.tag === 'ModuleTourHelpButton' && attribute(child, 'tab') === 'menu'))!
    expect(catalogCard).toBeDefined()
    expect(elements(catalogCard.children).some(node => node.tag === 'p' && node.children.some(child => child.type === 2 && child.content.includes('Los catálogos no aparecen en el menú operativo')))).toBe(true)
  })
})
