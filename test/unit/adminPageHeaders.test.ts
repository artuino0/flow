import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parse } from '@vue/compiler-sfc'
import type { ElementNode, TemplateChildNode } from '@vue/compiler-core'

function elements(children: TemplateChildNode[]): ElementNode[] {
  return children.flatMap(node => node.type === 1 ? [node, ...elements(node.children)] : [])
}

function attribute(node: ElementNode, name: string) {
  const prop = node.props.find(prop => prop.type === 6 && prop.name === name)
  return prop?.type === 6 ? prop.value?.content ?? '' : ''
}

function page(file: string) {
  const source = readFileSync(file, 'utf8')
  const ast = parse(source).descriptor.template!.ast!
  return { source, root: ast.children.find(node => node.type === 1) as ElementNode, nodes: elements(ast.children) }
}

function actions(header: ElementNode) {
  return header.children.find(node => node.type === 1 && node.props.some(prop => prop.type === 7 && prop.name === 'slot' && prop.arg?.type === 4 && prop.arg.content === 'actions')) as ElementNode
}

describe('encabezados de administración', () => {
  it.each([
    ['pages/roles/index.vue', 'Roles y Permisos'],
    ['pages/organizacion.vue', 'Organización del menú']
  ])('usa el encabezado compartido sin controles inactivos en %s', (file, title) => {
    const { root, nodes } = page(file)
    const headers = nodes.filter(node => node.tag === 'ListPageHeader')
    expect(headers).toHaveLength(1)
    const header = headers[0]!
    expect(root.children.find(node => node.type === 1)).toBe(header)
    expect(attribute(root, 'class')).toBe('flex flex-col gap-5')
    expect(attribute(header, 'title')).toBe(title)
    for (const name of ['show-search', 'show-toolbar']) {
      expect(header.props.some(prop => prop.type === 7 && prop.name === 'bind' && prop.arg?.type === 4 && prop.arg.content === name && prop.exp?.type === 4 && prop.exp.content === 'false')).toBe(true)
    }
    expect(nodes.some(node => node.tag === 'h1')).toBe(false)
  })

  it('conserva Crear rol y su acción dentro del slot, y la nota íntegra bajo el encabezado', () => {
    const { nodes, root } = page('pages/roles/index.vue')
    const header = nodes.find(node => node.tag === 'ListPageHeader')!
    const slot = actions(header)
    expect(slot).toBeDefined()
    const button = elements(slot.children).find(node => node.tag === 'button')!
    expect(button.loc.source).toContain('@click="openCreateModal"')
    expect(button.loc.source).toContain('Crear rol')
    expect(elements(button.children).some(node => node.tag === 'Plus')).toBe(true)
    expect(attribute(button, 'class')).toBe('flex items-center gap-1.5 rounded bg-brand-orange px-4 py-2.5 text-sm font-semibold text-brand-primary-fg hover:bg-brand-orange-hover')
    const note = nodes.find(node => attribute(node, 'role') === 'note')!
    expect(note).toBeDefined()
    expect(root.children.indexOf(note)).toBeGreaterThan(root.children.indexOf(header))
    expect(note.loc.source).toContain('Ocultar del menú conserva el permiso Ver, el acceso directo y los selectores relacionados. Sin Ver, el módulo no aparece.')
  })

  it('conserva las condiciones y la acción de Guardar organización en el slot', () => {
    const { nodes } = page('pages/organizacion.vue')
    const slot = actions(nodes.find(node => node.tag === 'ListPageHeader')!)
    expect(slot).toBeDefined()
    const button = elements(slot.children).find(node => node.tag === 'button')!
    expect(button.loc.source).toContain('v-if="data"')
    expect(button.loc.source).toContain(':disabled="saving || !dirty"')
    expect(button.loc.source).toContain('@click="save"')
    expect(button.loc.source).toContain("saving ? 'Guardando…' : 'Guardar organización'")
  })
})
