import { describe, it, expect } from 'vitest'
import { buildFieldType, getValidationRulesSchema } from '../../server/utils/dynamicSchema'

// HU-ERD-29: cubre la generacion de schema Zod desde metadatos (entity_fields
// -> ZodTypeAny), sin necesitar una base de datos - buildFieldType() es pura.

describe('buildFieldType', () => {
  describe('text', () => {
    it('acepta un string valido sin reglas', () => {
      const type = buildFieldType({ name: 'nombre', dataType: 'text', validationRules: {}, isRequired: true })
      expect(type.safeParse('Acme').success).toBe(true)
    })

    it('rechaza si falta minLength', () => {
      const type = buildFieldType({ name: 'x', dataType: 'text', validationRules: { minLength: 3 }, isRequired: true })
      expect(type.safeParse('ab').success).toBe(false)
      expect(type.safeParse('abc').success).toBe(true)
    })

    it('rechaza si excede maxLength', () => {
      const type = buildFieldType({ name: 'x', dataType: 'text', validationRules: { maxLength: 3 }, isRequired: true })
      expect(type.safeParse('abcd').success).toBe(false)
      expect(type.safeParse('abc').success).toBe(true)
    })

    it('valida pattern (regex)', () => {
      const type = buildFieldType({ name: 'email', dataType: 'text', validationRules: { pattern: '^[^@]+@[^@]+$' }, isRequired: true })
      expect(type.safeParse('a@b.com').success).toBe(true)
      expect(type.safeParse('no-es-email').success).toBe(false)
    })

    it('enum: solo acepta valores de la lista', () => {
      const type = buildFieldType({ name: 'estado', dataType: 'text', validationRules: { enum: ['activo', 'inactivo'] }, isRequired: true })
      expect(type.safeParse('activo').success).toBe(true)
      expect(type.safeParse('pendiente').success).toBe(false)
    })
  })

  describe('number', () => {
    it('rechaza no-numeros', () => {
      const type = buildFieldType({ name: 'edad', dataType: 'number', validationRules: {}, isRequired: true })
      expect(type.safeParse('abc' as unknown as number).success).toBe(false)
      expect(type.safeParse(30).success).toBe(true)
    })

    it('respeta min/max', () => {
      const type = buildFieldType({ name: 'edad', dataType: 'number', validationRules: { min: 0, max: 120 }, isRequired: true })
      expect(type.safeParse(-1).success).toBe(false)
      expect(type.safeParse(121).success).toBe(false)
      expect(type.safeParse(50).success).toBe(true)
    })

    it('integer:true rechaza decimales', () => {
      const type = buildFieldType({ name: 'cantidad', dataType: 'number', validationRules: { integer: true }, isRequired: true })
      expect(type.safeParse(1.5).success).toBe(false)
      expect(type.safeParse(2).success).toBe(true)
    })
  })

  describe('boolean', () => {
    it('solo acepta booleanos', () => {
      const type = buildFieldType({ name: 'activo', dataType: 'boolean', validationRules: {}, isRequired: true })
      expect(type.safeParse(true).success).toBe(true)
      expect(type.safeParse('true' as unknown as boolean).success).toBe(false)
    })
  })

  describe('date', () => {
    it('coerciona strings de fecha validas', () => {
      const type = buildFieldType({ name: 'fecha', dataType: 'date', validationRules: {}, isRequired: true })
      expect(type.safeParse('2026-08-29').success).toBe(true)
      expect(type.safeParse('no-es-fecha').success).toBe(false)
    })

    it('respeta min/max', () => {
      const type = buildFieldType({ name: 'fecha', dataType: 'date', validationRules: { min: '2026-01-01', max: '2026-12-31' }, isRequired: true })
      expect(type.safeParse('2025-12-31').success).toBe(false)
      expect(type.safeParse('2027-01-01').success).toBe(false)
      expect(type.safeParse('2026-06-15').success).toBe(true)
    })
  })

  describe('json', () => {
    it('acepta objetos y arrays', () => {
      const type = buildFieldType({ name: 'meta', dataType: 'json', validationRules: {}, isRequired: true })
      expect(type.safeParse({ a: 1 }).success).toBe(true)
      expect(type.safeParse([1, 2, 3]).success).toBe(true)
    })

    it('rechaza primitivos sueltos', () => {
      const type = buildFieldType({ name: 'meta', dataType: 'json', validationRules: {}, isRequired: true })
      expect(type.safeParse('texto plano' as unknown as object).success).toBe(false)
    })
  })

  describe('relation', () => {
    it('exige forma de uuid', () => {
      const type = buildFieldType({ name: 'cliente_id', dataType: 'relation', validationRules: {}, isRequired: true })
      expect(type.safeParse('11111111-1111-1111-1111-111111111111').success).toBe(true)
      expect(type.safeParse('no-es-uuid').success).toBe(false)
    })
  })

  // HU-ERD-68: array de objetos - lineas de item (ej. Cotizaciones con
  // producto/cantidad/precio). Solo valida la FORMA final de cada fila; la
  // semantica de copia (copyFrom, snapshot al elegir la relacion) es del
  // formulario (ERD-71/72), no de este generador.
  describe('tabla', () => {
    const columns = [
      { name: 'producto_id', label: 'Producto', type: 'relation', relationEntity: 'productos' },
      { name: 'precio_unitario', label: 'Precio unitario', type: 'number', copyFrom: 'productos.precio', editable: true },
      { name: 'cantidad', label: 'Cantidad', type: 'number', editable: true },
      { name: 'subtotal', label: 'Subtotal', type: 'number', readonly: true }
    ]

    it('acepta un array de filas con la forma correcta segun columns', () => {
      const type = buildFieldType({ name: 'items', dataType: 'tabla', validationRules: { columns }, isRequired: true })
      expect(
        type.safeParse([
          { producto_id: '11111111-1111-1111-1111-111111111111', precio_unitario: 100, cantidad: 2, subtotal: 200 }
        ]).success
      ).toBe(true)
    })

    it('rechaza una fila a la que le falta una columna', () => {
      const type = buildFieldType({ name: 'items', dataType: 'tabla', validationRules: { columns }, isRequired: true })
      expect(type.safeParse([{ producto_id: '11111111-1111-1111-1111-111111111111', cantidad: 2 }]).success).toBe(false)
    })

    it('rechaza una fila con el tipo de dato equivocado en una columna', () => {
      const type = buildFieldType({ name: 'items', dataType: 'tabla', validationRules: { columns }, isRequired: true })
      expect(
        type.safeParse([
          { producto_id: '11111111-1111-1111-1111-111111111111', precio_unitario: 'gratis', cantidad: 2, subtotal: 200 }
        ]).success
      ).toBe(false)
    })

    it('acepta un array vacio (sin filas todavia)', () => {
      const type = buildFieldType({ name: 'items', dataType: 'tabla', validationRules: { columns }, isRequired: true })
      expect(type.safeParse([]).success).toBe(true)
    })
  })

  describe('select', () => {
    const options = [
      { value: 'activo', label: 'Activo', color: 'green' },
      { value: 'suspendido', label: 'Suspendido', color: 'red' }
    ]

    it('acepta un value de la lista de opciones', () => {
      const type = buildFieldType({ name: 'estado', dataType: 'select', validationRules: { options }, isRequired: true })
      expect(type.safeParse('activo').success).toBe(true)
    })

    it('rechaza un value que no esta en las opciones', () => {
      const type = buildFieldType({ name: 'estado', dataType: 'select', validationRules: { options }, isRequired: true })
      expect(type.safeParse('inventado').success).toBe(false)
    })

    it('rechaza un array (select es un solo valor, no multiselect)', () => {
      const type = buildFieldType({ name: 'estado', dataType: 'select', validationRules: { options }, isRequired: true })
      expect(type.safeParse(['activo']).success).toBe(false)
    })
  })

  describe('multiselect', () => {
    const options = [
      { value: 'urgente', label: 'Urgente', color: 'red' },
      { value: 'seguimiento', label: 'Seguimiento', color: 'blue' }
    ]

    it('acepta un array de values validos', () => {
      const type = buildFieldType({ name: 'tags', dataType: 'multiselect', validationRules: { options }, isRequired: true })
      expect(type.safeParse(['urgente', 'seguimiento']).success).toBe(true)
    })

    it('rechaza si algun value no esta en las opciones', () => {
      const type = buildFieldType({ name: 'tags', dataType: 'multiselect', validationRules: { options }, isRequired: true })
      expect(type.safeParse(['urgente', 'inventado']).success).toBe(false)
    })

    it('acepta un array vacio', () => {
      const type = buildFieldType({ name: 'tags', dataType: 'multiselect', validationRules: { options }, isRequired: true })
      expect(type.safeParse([]).success).toBe(true)
    })
  })

  describe('tipo desconocido', () => {
    it('cae a z.any()', () => {
      const type = buildFieldType({ name: 'x', dataType: 'inventado', validationRules: {}, isRequired: true })
      expect(type.safeParse('cualquier cosa').success).toBe(true)
    })
  })

  // HU-ERD-71: getValidationRulesSchema() (no buildFieldType, que solo mira
  // la FORMA final) es donde vive el rechazo de duplicados - "value" y
  // "name" de columna son las claves reales que despues arma buildFieldType
  // (z.enum / objeto de fila), un duplicado ahi pisaria datos en silencio.
  describe('getValidationRulesSchema - duplicados (HU-ERD-71)', () => {
    it('select/multiselect rechazan un "value" repetido entre opciones', () => {
      const rules = { options: [{ value: 'alta', label: 'Alta' }, { value: 'alta', label: 'Alta (bis)' }] }
      expect(getValidationRulesSchema('select')!.safeParse(rules).success).toBe(false)
      expect(getValidationRulesSchema('multiselect')!.safeParse(rules).success).toBe(false)
    })

    it('select acepta values distintos', () => {
      const rules = { options: [{ value: 'alta', label: 'Alta' }, { value: 'baja', label: 'Baja' }] }
      expect(getValidationRulesSchema('select')!.safeParse(rules).success).toBe(true)
    })

    it('tabla rechaza un nombre de columna repetido', () => {
      const rules = { columns: [{ name: 'cantidad', label: 'Cantidad', type: 'number' }, { name: 'cantidad', label: 'Otra', type: 'text' }] }
      expect(getValidationRulesSchema('tabla')!.safeParse(rules).success).toBe(false)
    })

    it('tabla acepta una columna de relación con copyFrom/editable en otra columna', () => {
      const rules = {
        columns: [
          { name: 'producto_id', label: 'Producto', type: 'relation', relationEntity: 'productos' },
          { name: 'precio', label: 'Precio', type: 'number', copyFrom: 'productos.precio', editable: true }
        ]
      }
      expect(getValidationRulesSchema('tabla')!.safeParse(rules).success).toBe(true)
    })
  })

  describe('isRequired', () => {
    it('required=false vuelve el campo opcional y nullable', () => {
      const type = buildFieldType({ name: 'nombre', dataType: 'text', validationRules: {}, isRequired: false })
      expect(type.safeParse(undefined).success).toBe(true)
      expect(type.safeParse(null).success).toBe(true)
    })

    it('required=true no acepta undefined', () => {
      const type = buildFieldType({ name: 'nombre', dataType: 'text', validationRules: {}, isRequired: true })
      expect(type.safeParse(undefined).success).toBe(false)
    })
  })
})
