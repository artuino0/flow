// Duplicado deliberado de server/utils/pluralize.ts (mismo criterio de
// duplicacion ya usado en el proyecto para heuristicas cortas que corren en
// server Y cliente - ver utils/recordLabel.ts vs server/utils/relationLabels.ts).
// Usado aca solo para la vista previa en vivo del plural calculado, en el
// campo "Nombre en singular" de ModuleWizard.vue y pages/modulos/[id]/editar.vue -
// el calculo real que se guarda/muestra en el menu corre server-side
// (listVisibleEntities(), server/utils/moduleEntities.ts). Ver el comentario
// largo en server/utils/pluralize.ts para la tabla de reglas y la limitacion
// conocida (palabras terminadas en "-en" que cambian de acentuacion al
// pluralizar, ej. orden -> órdenes).
interface PluralRule {
  suffix: string
  replacement: string
}

const PLURAL_RULES: PluralRule[] = [
  { suffix: 'z', replacement: 'ces' },
  { suffix: 'ón', replacement: 'ones' },
  { suffix: 'án', replacement: 'anes' },
  { suffix: 'én', replacement: 'enes' },
  { suffix: 'ín', replacement: 'ines' },
  { suffix: 'ún', replacement: 'unes' }
]

function isVowel(ch: string): boolean {
  return 'aeiouáéíóúAEIOUÁÉÍÓÚ'.includes(ch)
}

function applyRule(word: string, rule: PluralRule): string {
  const base = word.slice(0, -rule.suffix.length)
  const matchedSuffix = word.slice(-rule.suffix.length)
  const isAllUpper = matchedSuffix === matchedSuffix.toUpperCase() && matchedSuffix !== matchedSuffix.toLowerCase()
  return base + (isAllUpper ? rule.replacement.toUpperCase() : rule.replacement)
}

function pluralizeWord(word: string): string {
  if (!word) return word
  const lower = word.toLowerCase()

  const rule = PLURAL_RULES.find((r) => lower.endsWith(r.suffix))
  if (rule) return applyRule(word, rule)

  const lastChar = word.slice(-1)
  const secondLastChar = word.slice(-2, -1)
  const lastLower = lastChar.toLowerCase()

  if ((lastLower === 's' || lastLower === 'x') && isVowel(secondLastChar)) {
    return word
  }

  if (isVowel(lastChar)) {
    return word + 's'
  }

  return word + 'es'
}

/** Ver server/utils/pluralize.ts - misma logica (misma tabla), duplicada a proposito. */
export function pluralize(text: string): string {
  const trimmed = text.trim()
  if (!trimmed) return trimmed
  const words = trimmed.split(/\s+/)
  words[0] = pluralizeWord(words[0])
  return words.join(' ')
}
