import { isEditorContrast, isDesignerContrast, isLabelContrast, isResizeContrast, isSitesContrast, themeContrasts } from '../test/helpers/themeContrast'

const results = themeContrasts()
for (const [heading, entries] of [
  ['Pares generales: 17 déficits originales conservados', results.filter(result => !isLabelContrast(result) && !isDesignerContrast(result) && !isResizeContrast(result) && !isSitesContrast(result) && !isEditorContrast(result))],
  ['Editor HU-168: claros heredados autorizados; oscuros nuevos AA obligatorio', results.filter(isEditorContrast)],
  ['Sites HU-167: claros originales conservados y documentados; cero oscuros nuevos bajo AA', results.filter(isSitesContrast)],
  ['Redimensionador BUG-166: claro exacto heredado, foco y marca oscuros >=3:1', results.filter(isResizeContrast)],
  ['Editor de etiquetas HU-164: claros heredados autorizados, separados de los 17 originales', results.filter(isLabelContrast)],
  ['Diseñador HU-165: claros heredados autorizados por el usuario, separados de originales y etiquetas', results.filter(isDesignerContrast)]
] as const) {
  console.log(heading)
  for (const result of entries) console.log(`${result.id}: ${result.ratio.toFixed(3)}:1 / mínimo ${result.minimum}:1 ${result.ratio >= result.minimum ? 'AA' : 'NO AA'}`)
}
const failures = results.filter(result => result.ratio < result.minimum)
console.log(`${results.length} pares; originales=${failures.filter(result => !isLabelContrast(result) && !isDesignerContrast(result) && !isResizeContrast(result) && !isSitesContrast(result) && !isEditorContrast(result)).length}; claros etiquetas=${failures.filter(result => isLabelContrast(result) && result.theme === 'light').length}; claros diseñador=${failures.filter(result => isDesignerContrast(result) && result.theme === 'light').length}; claros Sites=${failures.filter(result => isSitesContrast(result) && result.theme === 'light').length}; claros editor=${failures.filter(result => isEditorContrast(result) && result.theme === 'light').length}; claros redimensionador=${failures.filter(result => isResizeContrast(result) && result.theme === 'light').length}; oscuros nuevos deficientes=${failures.filter(result => (isLabelContrast(result) || isDesignerContrast(result) || isResizeContrast(result) || isSitesContrast(result) || isEditorContrast(result)) && result.theme === 'dark').length}.`)
// La auditoría estricta informa también los valores de Pencil y claros que
// la tarea exige conservar. No transforma sus fallos en resultados AA.
process.exitCode = results.some(result => result.ratio < result.minimum) ? 1 : 0
