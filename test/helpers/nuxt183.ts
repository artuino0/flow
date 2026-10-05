import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import ts from 'typescript'

// Ejecuta las fuentes reales con las banderas SSR/cliente y adaptadores Nuxt explícitos.
export function loadNuxtSource183(file: string, globals: Record<string, unknown>, imports: Record<string, unknown> = {}, client = true) {
  const require = createRequire(import.meta.url)
  const code = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    transformers: { before: [context => source => {
      const visit: ts.Visitor = node => ts.isMetaProperty(node) && node.keywordToken === ts.SyntaxKind.ImportKeyword
        ? ts.factory.createIdentifier('__testImportMeta') : ts.visitEachChild(node, visit, context)
      return ts.visitNode(source, visit) as ts.SourceFile
    }] }
  }).outputText
  const exports: Record<string, Function> = {}
  new Function('require', 'exports', '__testImportMeta', ...Object.keys(globals), code)(
    (id: string) => imports[id] ?? require(id), exports, { client, server: !client }, ...Object.values(globals))
  return exports
}
