export type ListFilterOperator = 'eq' | 'neq' | 'contains' | 'gt' | 'gte' | 'lt' | 'lte' | 'between' | 'is_true' | 'is_false'

export interface ListFilterOperatorMeta { value: ListFilterOperator; label: string; values: number }

const TEXT: ListFilterOperatorMeta[] = [
  { value: 'contains', label: 'Contiene', values: 1 },
  { value: 'eq', label: 'Es igual a', values: 1 },
  { value: 'neq', label: 'Es diferente de', values: 1 }
]
const COMPARABLE: ListFilterOperatorMeta[] = [
  { value: 'eq', label: 'Es igual a', values: 1 },
  { value: 'neq', label: 'Es diferente de', values: 1 },
  { value: 'gt', label: 'Es mayor que', values: 1 },
  { value: 'gte', label: 'Es mayor o igual que', values: 1 },
  { value: 'lt', label: 'Es menor que', values: 1 },
  { value: 'lte', label: 'Es menor o igual que', values: 1 },
  { value: 'between', label: 'Está entre', values: 2 }
]

export function isListFilterable(dataType: string): boolean {
  return ['text', 'textarea', 'number', 'currency', 'incremental', 'date', 'datetime', 'boolean', 'select', 'multiselect', 'relation'].includes(dataType)
}

export function listFilterOperators(dataType: string): ListFilterOperatorMeta[] {
  if (dataType === 'boolean') return [{ value: 'is_true', label: 'Es verdadero', values: 0 }, { value: 'is_false', label: 'Es falso', values: 0 }]
  if (dataType === 'number' || dataType === 'currency' || dataType === 'incremental' || dataType === 'date' || dataType === 'datetime') return COMPARABLE
  if (dataType === 'select' || dataType === 'multiselect' || dataType === 'relation') return [{ value: 'eq', label: 'Es igual a', values: 1 }, { value: 'neq', label: 'Es diferente de', values: 1 }]
  return TEXT
}
