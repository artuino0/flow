import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { compileScript, parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import type { Component } from 'vue'

/** Monta el SFC real sin plugin Nuxt; las dependencias de aplicación son explícitas. */
export function compileVueComponent(file: string, imports: Record<string, unknown> = {}, globals: Record<string, unknown> = {}): Component {
  const require = createRequire(import.meta.url)
  const compiled = compileScript(parse(readFileSync(file, 'utf8')).descriptor, { id: file, inlineTemplate: true })
  const code = ts.transpileModule(compiled.content, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const exports: { default?: Component } = {}
  new Function('require', 'exports', ...Object.keys(globals), code)((id: string) => imports[id] ?? require(id), exports, ...Object.values(globals))
  return exports.default!
}
