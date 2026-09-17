export interface WorkflowField { name: string; dataType: string }

export function workflowValue(raw: unknown, field?: WorkflowField): unknown {
  if (field?.dataType === 'number' || field?.dataType === 'currency') {
    if (raw === '' || raw === null || raw === undefined) return null
    const value = Number(raw)
    if (!Number.isFinite(value)) throw new Error('Introduce un número válido.')
    return field.dataType === 'currency' ? String(raw).trim() : value
  }
  if (field?.dataType === 'boolean') return raw === true || raw === 'true'
  return raw
}

export function workflowInputType(field?: WorkflowField): string {
  return field?.dataType === 'number' || field?.dataType === 'currency' ? 'number' : field?.dataType === 'date' ? 'date' : 'text'
}
