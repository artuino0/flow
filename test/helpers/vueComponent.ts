import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import type { Component } from 'vue'

/** Monta el SFC real sin plugin Nuxt; las dependencias de aplicación son explícitas. */
export function compileVueComponent(file: string, imports: Record<string, unknown> = {}, globals: Record<string, unknown> = {}, meta = { client: true, server: false, dev: false }): Component {
  const require = createRequire(import.meta.url)
  const descriptor = parse(readFileSync(file, 'utf8')).descriptor
  const content = descriptor.script || descriptor.scriptSetup
    ? compileScript(descriptor, { id: file, inlineTemplate: true }).content
    : compileTemplate({ source: descriptor.template?.content ?? '', filename: file, id: file }).code + '\nexport default { render }'
  const code = ts.transpileModule(content, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    // Los SFC reales pueden consultar las banderas de Nuxt. Se transforma
    // el nodo sintáctico, sin alterar strings ni el comportamiento del SFC.
    transformers: { before: [context => source => {
      const visit: ts.Visitor = node => ts.isMetaProperty(node) && node.keywordToken === ts.SyntaxKind.ImportKeyword
        ? ts.factory.createIdentifier('__testImportMeta')
        : ts.visitEachChild(node, visit, context)
      return ts.visitNode(source, visit) as ts.SourceFile
    }] }
  }).outputText
  const exports: { default?: Component } = {}
  new Function('require', 'exports', '__testImportMeta', ...Object.keys(globals), code)((id: string) => imports[id] ?? require(id), exports, meta, ...Object.values(globals))
  return exports.default!
}
