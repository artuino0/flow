// Expresiones de campos calculados: aritmética, comparaciones y condicionales
// sobre los campos del mismo registro. Es un intérprete propio (sin eval ni
// Function): la expresión se convierte en un árbol y solo se pueden usar
// números, textos entre comillas, nombres de campo y estas funciones.
//
//   sueldo + bonos - isr - imss
//   SI(tipo = 'salida'; -cantidad; cantidad)         (también IF, separador `;` o `,`)
//   SI(Y(cantidad > 0; precio > 0); cantidad * precio; 0)
//   REDONDEAR(subtotal * 0.16; 2)
//
// Funciones: SI/IF, Y/AND, O/OR, NO/NOT, MIN, MAX, REDONDEAR/ROUND, ABS.
// Operadores: + - * / (y menos unario), = <> != < > <= >=. La división entre
// cero da 0, igual que las fórmulas simples de siempre.

export type CalcValue = number | string | boolean

export type CalcNode =
  | { type: 'num'; value: number }
  | { type: 'str'; value: string }
  | { type: 'bool'; value: boolean }
  | { type: 'field'; name: string }
  | { type: 'neg'; arg: CalcNode }
  | { type: 'bin'; op: '+' | '-' | '*' | '/' | '=' | '<>' | '<' | '>' | '<=' | '>='; left: CalcNode; right: CalcNode }
  | { type: 'call'; fn: CalcFunction; args: CalcNode[] }

export type CalcFunction = 'if' | 'and' | 'or' | 'not' | 'min' | 'max' | 'round' | 'abs'

export class CalcExpressionError extends Error {
  constructor(message: string, readonly position?: number) {
    super(message)
    this.name = 'CalcExpressionError'
  }
}

export const MAX_EXPRESSION_LENGTH = 500

const FUNCTIONS: Record<string, { fn: CalcFunction; min: number; max: number }> = {
  si: { fn: 'if', min: 3, max: 3 }, if: { fn: 'if', min: 3, max: 3 },
  y: { fn: 'and', min: 2, max: 8 }, and: { fn: 'and', min: 2, max: 8 },
  o: { fn: 'or', min: 2, max: 8 }, or: { fn: 'or', min: 2, max: 8 },
  no: { fn: 'not', min: 1, max: 1 }, not: { fn: 'not', min: 1, max: 1 },
  min: { fn: 'min', min: 2, max: 8 }, max: { fn: 'max', min: 2, max: 8 },
  redondear: { fn: 'round', min: 1, max: 2 }, round: { fn: 'round', min: 1, max: 2 },
  abs: { fn: 'abs', min: 1, max: 1 }
}

type Token =
  | { kind: 'num'; value: number; pos: number }
  | { kind: 'str'; value: string; pos: number }
  | { kind: 'ident'; value: string; pos: number }
  | { kind: 'op'; value: string; pos: number }
  | { kind: 'end'; pos: number }

function tokenize(source: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  while (i < source.length) {
    const char = source[i]!
    if (/\s/.test(char)) { i++; continue }
    if (/[0-9]/.test(char) || (char === '.' && /[0-9]/.test(source[i + 1] ?? ''))) {
      const match = /^(\d+(\.\d+)?|\.\d+)/.exec(source.slice(i))!
      tokens.push({ kind: 'num', value: Number(match[0]), pos: i })
      i += match[0].length
      continue
    }
    if (char === '"' || char === "'") {
      const end = source.indexOf(char, i + 1)
      if (end === -1) throw new CalcExpressionError('Falta cerrar unas comillas', i)
      tokens.push({ kind: 'str', value: source.slice(i + 1, end), pos: i })
      i = end + 1
      continue
    }
    if (/[a-zA-Z_]/.test(char)) {
      const match = /^[a-zA-Z_][a-zA-Z0-9_]*/.exec(source.slice(i))!
      tokens.push({ kind: 'ident', value: match[0], pos: i })
      i += match[0].length
      continue
    }
    const two = source.slice(i, i + 2)
    if (['<=', '>=', '<>', '!='].includes(two)) {
      tokens.push({ kind: 'op', value: two === '!=' ? '<>' : two, pos: i })
      i += 2
      continue
    }
    if ('+-*/()<>=,;'.includes(char)) {
      tokens.push({ kind: 'op', value: char, pos: i })
      i++
      continue
    }
    throw new CalcExpressionError(`Carácter no permitido: "${char}"`, i)
  }
  tokens.push({ kind: 'end', pos: source.length })
  return tokens
}

export function parseExpression(source: string): CalcNode {
  if (typeof source !== 'string' || !source.trim()) throw new CalcExpressionError('Escribe una expresión')
  if (source.length > MAX_EXPRESSION_LENGTH) throw new CalcExpressionError(`La expresión no puede pasar de ${MAX_EXPRESSION_LENGTH} caracteres`)
  const tokens = tokenize(source)
  let index = 0
  const peek = () => tokens[index]!
  const isOp = (value: string) => peek().kind === 'op' && (peek() as { value: string }).value === value
  const expect = (value: string, message: string) => {
    if (!isOp(value)) throw new CalcExpressionError(message, peek().pos)
    index++
  }

  function parseComparison(): CalcNode {
    let left = parseAdditive()
    while (peek().kind === 'op' && ['=', '<>', '<', '>', '<=', '>='].includes((peek() as { value: string }).value)) {
      const op = (peek() as { value: string }).value as '=' | '<>' | '<' | '>' | '<=' | '>='
      index++
      left = { type: 'bin', op, left, right: parseAdditive() }
    }
    return left
  }
  function parseAdditive(): CalcNode {
    let left = parseTerm()
    while (isOp('+') || isOp('-')) {
      const op = (peek() as { value: string }).value as '+' | '-'
      index++
      left = { type: 'bin', op, left, right: parseTerm() }
    }
    return left
  }
  function parseTerm(): CalcNode {
    let left = parseUnary()
    while (isOp('*') || isOp('/')) {
      const op = (peek() as { value: string }).value as '*' | '/'
      index++
      left = { type: 'bin', op, left, right: parseUnary() }
    }
    return left
  }
  function parseUnary(): CalcNode {
    if (isOp('-')) { index++; return { type: 'neg', arg: parseUnary() } }
    if (isOp('+')) { index++; return parseUnary() }
    return parsePrimary()
  }
  function parsePrimary(): CalcNode {
    const token = peek()
    if (token.kind === 'num') { index++; return { type: 'num', value: token.value } }
    if (token.kind === 'str') { index++; return { type: 'str', value: token.value } }
    if (token.kind === 'op' && token.value === '(') {
      index++
      const inner = parseComparison()
      expect(')', 'Falta cerrar un paréntesis')
      return inner
    }
    if (token.kind === 'ident') {
      index++
      const lower = token.value.toLowerCase()
      if (isOp('(')) {
        const fn = FUNCTIONS[lower]
        if (!fn) throw new CalcExpressionError(`Función desconocida: ${token.value}`, token.pos)
        index++
        const args: CalcNode[] = []
        if (!isOp(')')) {
          args.push(parseComparison())
          while (isOp(';') || isOp(',')) { index++; args.push(parseComparison()) }
        }
        expect(')', `Falta cerrar el paréntesis de ${token.value}`)
        if (args.length < fn.min || args.length > fn.max) {
          throw new CalcExpressionError(`${token.value} espera ${fn.min === fn.max ? fn.min : `entre ${fn.min} y ${fn.max}`} argumentos`, token.pos)
        }
        return { type: 'call', fn: fn.fn, args }
      }
      if (lower === 'true' || lower === 'verdadero') return { type: 'bool', value: true }
      if (lower === 'false' || lower === 'falso') return { type: 'bool', value: false }
      return { type: 'field', name: token.value }
    }
    throw new CalcExpressionError(token.kind === 'end' ? 'La expresión está incompleta' : 'Se esperaba un valor', token.pos)
  }

  const tree = parseComparison()
  if (peek().kind !== 'end') throw new CalcExpressionError('Sobra texto al final de la expresión', peek().pos)
  return tree
}

/** Nombres de campo que usa la expresión (sin repetir). */
export function collectFieldRefs(node: CalcNode, into = new Set<string>()): Set<string> {
  if (node.type === 'field') into.add(node.name)
  else if (node.type === 'neg') collectFieldRefs(node.arg, into)
  else if (node.type === 'bin') { collectFieldRefs(node.left, into); collectFieldRefs(node.right, into) }
  else if (node.type === 'call') for (const arg of node.args) collectFieldRefs(arg, into)
  return into
}

function toNumber(value: CalcValue): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (typeof value === 'boolean') return value ? 1 : 0
  const parsed = Number(value)
  return value.trim() !== '' && Number.isFinite(parsed) ? parsed : 0
}
function toBool(value: CalcValue): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  return value !== '' && value.toLowerCase() !== 'false'
}
export function compareValues(left: CalcValue, right: CalcValue, op: string): boolean {
  // Si ambos lados son numéricos se comparan como números; si no, como texto sin distinguir mayúsculas.
  const numeric = (value: CalcValue) => typeof value === 'number' || typeof value === 'boolean' || (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)))
  let a: number | string
  let b: number | string
  if (numeric(left) && numeric(right)) { a = toNumber(left); b = toNumber(right) } else { a = String(left).toLowerCase(); b = String(right).toLowerCase() }
  if (op === '=') return a === b
  if (op === '<>') return a !== b
  if (op === '<') return a < b
  if (op === '>') return a > b
  if (op === '<=') return a <= b
  return a >= b
}

/** Evalúa el árbol; `resolve` entrega el valor actual de cada campo. */
export function evaluateExpression(node: CalcNode, resolve: (name: string) => CalcValue): CalcValue {
  switch (node.type) {
    case 'num': case 'str': case 'bool': return node.value
    case 'field': return resolve(node.name)
    case 'neg': return -toNumber(evaluateExpression(node.arg, resolve))
    case 'bin': {
      const left = evaluateExpression(node.left, resolve)
      const right = evaluateExpression(node.right, resolve)
      if (['=', '<>', '<', '>', '<=', '>='].includes(node.op)) return compareValues(left, right, node.op)
      const a = toNumber(left)
      const b = toNumber(right)
      if (node.op === '+') return a + b
      if (node.op === '-') return a - b
      if (node.op === '*') return a * b
      return b === 0 ? 0 : a / b
    }
    case 'call': {
      const [first, second, third] = node.args
      switch (node.fn) {
        case 'if': return toBool(evaluateExpression(first!, resolve)) ? evaluateExpression(second!, resolve) : evaluateExpression(third!, resolve)
        // Y / O evalúan todos sus argumentos: no hay efectos secundarios y así es predecible.
        case 'and': return node.args.map(arg => toBool(evaluateExpression(arg, resolve))).every(Boolean)
        case 'or': return node.args.map(arg => toBool(evaluateExpression(arg, resolve))).some(Boolean)
        case 'not': return !toBool(evaluateExpression(first!, resolve))
        case 'min': return Math.min(...node.args.map(arg => toNumber(evaluateExpression(arg, resolve))))
        case 'max': return Math.max(...node.args.map(arg => toNumber(evaluateExpression(arg, resolve))))
        case 'abs': return Math.abs(toNumber(evaluateExpression(first!, resolve)))
        case 'round': {
          const value = toNumber(evaluateExpression(first!, resolve))
          const decimals = second ? Math.max(0, Math.min(6, Math.trunc(toNumber(evaluateExpression(second, resolve))))) : 0
          const factor = 10 ** decimals
          return Math.round((value + Number.EPSILON) * factor) / factor
        }
      }
    }
  }
}

/** Resultado numérico final de una expresión (texto → 0, verdadero → 1). */
export function evaluateExpressionNumber(node: CalcNode, resolve: (name: string) => CalcValue): number {
  return toNumber(evaluateExpression(node, resolve))
}
