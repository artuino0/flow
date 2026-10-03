import { isDesignerContrast, isLabelContrast, themeContrasts } from '../test/helpers/themeContrast'

const results = themeContrasts()
for (const [heading, entries] of [
  ['Pares generales: 17 déficits originales conservados', results.filter(result => !isLabelContrast(result) && !isDesignerContrast(result))],
  ['Editor de etiquetas HU-164: claros heredados autorizados, separados de los 17 originales', results.filter(isLabelContrast)],
  ['Diseñador HU-165: claros heredados autorizados por el usuario, separados de originales y etiquetas', results.filter(isDesignerContrast)]
] as const) {
  console.log(heading)
  for (const result of entries) console.log(`${result.id}: ${result.ratio.toFixed(3)}:1 / mínimo ${result.minimum}:1 ${result.ratio >= result.minimum ? 'AA' : 'NO AA'}`)
}
const failures = results.filter(result => result.ratio < result.minimum)
console.log(`${results.length} pares; originales=${failures.filter(result => !isLabelContrast(result) && !isDesignerContrast(result)).length}; claros etiquetas=${failures.filter(result => isLabelContrast(result) && result.theme === 'light').length}; claros diseñador=${failures.filter(result => isDesignerContrast(result) && result.theme === 'light').length}; oscuros nuevos deficientes=${failures.filter(result => (isLabelContrast(result) || isDesignerContrast(result)) && result.theme === 'dark').length}.`)
// La auditoría estricta informa también los valores de Pencil y claros que
// la tarea exige conservar. No transforma sus fallos en resultados AA.
process.exitCode = results.some(result => result.ratio < result.minimum) ? 1 : 0
