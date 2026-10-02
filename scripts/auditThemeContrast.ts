import { themeContrasts } from '../test/helpers/themeContrast'

const results = themeContrasts()
for (const result of results) console.log(`${result.id}: ${result.ratio.toFixed(3)}:1 / mínimo ${result.minimum}:1 ${result.ratio >= result.minimum ? 'AA' : 'NO AA'}`)
// La auditoría estricta informa también los valores de Pencil y claros que
// la tarea exige conservar. No transforma sus fallos en resultados AA.
process.exitCode = results.some(result => result.ratio < result.minimum) ? 1 : 0
