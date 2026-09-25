import { describe, it, expect } from 'vitest'
import { CalcExpressionError, collectFieldRefs, evaluateExpression, evaluateExpressionNumber, parseExpression } from '../../utils/calcExpression'

const run = (source: string, values: Record<string, number | string | boolean> = {}) =>
  evaluateExpression(parseExpression(source), name => (Object.hasOwn(values, name) ? values[name]! : 0))

describe('calcExpression', () => {
  it('respeta precedencia, paréntesis y menos unario', () => {
    expect(run('1 + 2 * 3')).toBe(7)
    expect(run('(1 + 2) * 3')).toBe(9)
    expect(run('-a + 10', { a: 4 })).toBe(6)
    expect(run('10 - 2 - 3')).toBe(5)
    expect(run('8 / 2 / 2')).toBe(2)
  })

  it('calcula el neto de nómina en un solo campo', () => {
    expect(run('sueldo + bonos - isr - imss', { sueldo: 9250, bonos: 500, isr: 850, imss: 250 })).toBe(8650)
  })

  it('la división entre cero da 0', () => {
    expect(run('a / b', { a: 5, b: 0 })).toBe(0)
  })

  it('condicionales con textos: signo según el tipo de movimiento', () => {
    const signed = "SI(tipo = 'salida'; -cantidad; cantidad)"
    expect(run(signed, { tipo: 'salida', cantidad: 5 })).toBe(-5)
    expect(run(signed, { tipo: 'entrada', cantidad: 5 })).toBe(5)
    expect(run(signed.replace('SI', 'IF').replaceAll(';', ','), { tipo: 'SALIDA', cantidad: 2 })).toBe(-2) // sin distinguir mayúsculas
  })

  it('comparaciones numéricas, lógicas y funciones', () => {
    expect(run('SI(Y(a > 0; b > 0); a * b; 0)', { a: 3, b: 4 })).toBe(12)
    expect(run('SI(Y(a > 0; b > 0); a * b; 0)', { a: 3, b: 0 })).toBe(0)
    expect(run('SI(O(a = 1; a = 2); 10; 20)', { a: 2 })).toBe(10)
    expect(run('SI(NO(a = 1); 10; 20)', { a: 1 })).toBe(20)
    expect(run('REDONDEAR(10 / 3; 2)')).toBe(3.33)
    expect(run('MAX(a; b; 3)', { a: 1, b: 7 })).toBe(7)
    expect(run('MIN(a; b)', { a: 1, b: 7 })).toBe(1)
    expect(run('ABS(a)', { a: -4 })).toBe(4)
    expect(run('a <> b', { a: 1, b: 2 })).toBe(true)
    expect(run('a != b', { a: 1, b: 1 })).toBe(false)
  })

  it('un valor vacío cuenta como 0 y un booleano como 1/0', () => {
    expect(run('a + 1', { a: '' })).toBe(1)
    expect(run('a + 1', { a: true })).toBe(2)
    expect(evaluateExpressionNumber(parseExpression("'abc'"), () => 0)).toBe(0)
  })

  it('lista los campos usados', () => {
    expect([...collectFieldRefs(parseExpression("SI(tipo = 'x'; a + b; a)"))].sort()).toEqual(['a', 'b', 'tipo'])
  })

  it('rechaza expresiones inválidas con un mensaje claro', () => {
    for (const bad of ['', '1 +', '(1 + 2', 'foo(1)', 'SI(1; 2)', '1 2', "'abc", '1 $ 2', 'a = = 1', 'REDONDEAR()']) {
      expect(() => parseExpression(bad), bad).toThrow(CalcExpressionError)
    }
    expect(() => parseExpression('x'.repeat(501))).toThrow(/500/)
  })

  it('no ejecuta código: identificadores raros son solo nombres de campo', () => {
    expect(run('constructor + 1', {})).toBe(1)
    expect(() => parseExpression('a.b')).toThrow(CalcExpressionError)
    expect(() => parseExpression('process.exit()')).toThrow(CalcExpressionError)
  })
})
