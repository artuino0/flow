// Pedido directo del usuario (2026-09-05, aclaracion sobre HU anterior):
// "queria que con js en el menu se pusiera en plural, no queria un campo
// nuevo" - se agrega esta funcion para calcular el plural en español a
// partir de `entities.singularName` (el campo opcional que el usuario pidio
// mantener), usada en listVisibleEntities() para lo que se muestra en el
// menu (components/AppNav.vue via GET /api/nav/entities).
//
// Estructura en tabla (pedido directo del usuario, mismo dia: "seria mejor
// una tabla donde sepas que por ejemplo cuando termina en z se reemplaza con
// ces, cuando termina en on, ones") en vez de un if/else largo - PLURAL_RULES
// es la lista real de "termina en esto -> se reemplaza por esto", en orden
// (la primera que matchee gana); agregar un caso nuevo es agregar una fila,
// no tocar logica. Cubre los casos mas comunes en nombres de
// modulos/entidades de un ERP (Empaque, Recepción, Embarque, Manifiesto,
// Cliente, Producto, Factura, Pedido, Cotización) - lo que NO matchea
// ninguna fila cae a la regla general de abajo (vocal->+s, consonante->+es).
//
// Multi-palabra ("Orden de Compra"): se pluraliza SOLO la primera palabra
// (el nucleo del sustantivo en el patron "Nombre de Nombre", el mas comun en
// nombres de modulos) - "Orden de Compra" -> "Ordenes de Compra".
//
// Limitacion conocida, documentada a proposito (esta tabla no es un motor de
// acentuacion completo): palabras terminadas en "-en" NO acentuado que
// cambian de acentuacion al pluralizar (orden -> órdenes, joven -> jóvenes,
// examen -> exámenes) no tienen fila propia (no terminan en "on/an/en/in/un"
// CON acento, que es lo que matchean las filas de abajo) y caen a la regla
// general, que devuelve "ordenes" sin el acento nuevo. Si aparece un caso
// asi en la practica, se puede sumar una fila especifica para esa palabra
// (ej. { suffix: 'orden', replacement: 'órdenes' }) sin tocar el resto.
interface PluralRule {
  /** Terminacion del singular (sin distinguir mayus/minus) que dispara esta fila. */
  suffix: string
  /** Con que se reemplaza esa terminacion para armar el plural. */
  replacement: string
}

const PLURAL_RULES: PluralRule[] = [
  { suffix: 'z', replacement: 'ces' }, // lápiz -> lápices, luz -> luces
  { suffix: 'ón', replacement: 'ones' }, // razón -> razones, recepción -> recepciones, cotización -> cotizaciones
  { suffix: 'án', replacement: 'anes' }, // capitán -> capitanes
  { suffix: 'én', replacement: 'enes' }, // andén -> andenes
  { suffix: 'ín', replacement: 'ines' }, // jardín -> jardines
  { suffix: 'ún', replacement: 'unes' } // atún -> atunes
]

function isVowel(ch: string): boolean {
  return 'aeiouáéíóúAEIOUÁÉÍÓÚ'.includes(ch)
}

/** Reemplaza `suffix` (largo `rule.suffix.length`, tomado tal cual de `word` para conservar mayus/minus) por `rule.replacement`. */
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

  // Regla general (no esta en la tabla porque no es "termina en X -> pasa a
  // Y" de una terminacion fija, sino "que tipo de letra es la ultima").
  const lastChar = word.slice(-1)
  const secondLastChar = word.slice(-2, -1)
  const lastLower = lastChar.toLowerCase()

  // Ya termina en "s"/"x" sobre vocal atona (lunes, martes) -> no cambia
  // (idempotente si esta funcion se llama sobre un plural por error).
  if ((lastLower === 's' || lastLower === 'x') && isVowel(secondLastChar)) {
    return word
  }

  // Termina en vocal -> suma "s".
  if (isVowel(lastChar)) {
    return word + 's'
  }

  // Cualquier otra consonante -> suma "es".
  return word + 'es'
}

/**
 * Calcula el plural en español de `text` (ver PLURAL_RULES y la limitacion
 * conocida en el comentario de arriba). Si `text` tiene mas de una palabra,
 * pluraliza solo la primera.
 */
export function pluralize(text: string): string {
  const trimmed = text.trim()
  if (!trimmed) return trimmed
  const words = trimmed.split(/\s+/)
  words[0] = pluralizeWord(words[0])
  return words.join(' ')
}
