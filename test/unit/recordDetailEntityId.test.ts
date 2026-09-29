import { readFileSync } from 'node:fs'
import { baseParse, NodeTypes, type ElementNode, type TemplateChildNode } from '@vue/compiler-dom'
import { parse } from '@vue/compiler-sfc'
import { describe, expect, it } from 'vitest'

function componentBindings(relativePath: string, componentName: string) {
  const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8')
  const { descriptor, errors } = parse(source)
  expect(errors).toEqual([])
  expect(descriptor.template).not.toBeNull()

  const root = baseParse(descriptor.template!.content)
  const elements = findElements(root.children, componentName)
  expect(elements).toHaveLength(1)
  return elements[0]!.props
}

function findElements(nodes: TemplateChildNode[], tag: string): ElementNode[] {
  return nodes.flatMap((node) => {
    if (node.type !== NodeTypes.ELEMENT) return []
    return [
      ...(node.tag === tag ? [node] : []),
      ...findElements(node.children, tag)
    ]
  })
}

function boundValue(props: ElementNode['props'], name: string): string | undefined {
  const binding = props.find((prop) =>
    prop.type === NodeTypes.DIRECTIVE &&
    prop.name === 'bind' &&
    prop.arg?.type === NodeTypes.SIMPLE_EXPRESSION &&
    prop.arg.content === name
  )
  return binding?.type === NodeTypes.DIRECTIVE && binding.exp?.type === NodeTypes.SIMPLE_EXPRESSION
    ? binding.exp.content
    : undefined
}

describe('RecordDetailView file upload entity context', () => {
  it('passes the module entity ID to DynamicForm instead of the record ID', () => {
    const props = componentBindings('../../components/RecordDetailView.vue', 'DynamicForm')

    expect(boundValue(props, 'entity-id')).toBe('entityId')
  })

  it.each([
    ['../../pages/registros/[entity]/[id]/index.vue', 'data.entity.id'],
    ['../../pages/modulos/[id]/editar.vue', 'currentModule.id'],
    ['../../components/ModuleWizard.vue', 'entityId']
  ])('passes the owning entity ID from %s', (relativePath, expectedEntityId) => {
    const props = componentBindings(relativePath, 'RecordDetailView')

    expect(boundValue(props, 'entity-id')).toBe(expectedEntityId)
  })
})
