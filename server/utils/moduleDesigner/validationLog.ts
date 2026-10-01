import { KNOWN_DATA_TYPES } from '~/server/utils/dynamicSchema'
import type { BlueprintValidationError } from '~/server/utils/blueprint/validate'

const ruleKeys = new Set(['minLength', 'maxLength', 'pattern', 'enum', 'min', 'max', 'integer', 'calculation', 'currency', 'decimals', 'allowNegative', 'relationEntity', 'multiple', 'roles', 'defaultCurrentUser', 'unique', 'columns', 'options', 'digits', 'prefix', 'prefixSource'])
const calculationKeys = new Set(['kind', 'operator', 'leftField', 'rightField', 'aggregate', 'sourceEntity', 'relationField', 'valueField', 'filter', 'field', 'value', 'expression'])
const pathKeys = new Set([...ruleKeys, ...calculationKeys, 'modules', 'fields', 'operations', 'module', 'changes', 'op', 'slug', 'name', 'label', 'ref', 'action', 'dataType', 'required', 'isOwnerField', 'validationRules', 'workflow', 'enabled', 'initial', 'states', 'locked', 'editableFields', 'transitions', 'from', 'to', 'layout', 'x', 'y', 'rules', 'type', 'mode', 'when', 'message', 'lineEntity', 'relatedField', 'compareField', 'lines', 'childRef', 'totals', 'associations', 'sourceRef', 'targetRef', 'roles', 'permissions', 'moduleRef', 'visibility', 'canRead', 'canCreate', 'canUpdate', 'canDelete', 'icon', 'description', 'singularName', 'snapshot', 'detailLayout', 'relations', 'entitySlug', 'fieldName', 'editable', 'calendarConfig', 'startDateField', 'startTimeField', 'durationField', 'endField', 'titleField', 'colorField', 'groupByField', 'version', 'summary', 'blueprint', 'explanation'])

export function designerValidationLog(errors: BlueprintValidationError[], attempt: number) {
  return { attempt, errors: errors.map(error => {
    const ruleKey = error.ruleKey ? ruleKeys.has(error.ruleKey) ? error.ruleKey : 'unsupported' : null
    let path = error.path.replace(/\.(states|layout)\.[^.]+/g, '.$1.*')
    if (ruleKey === 'unsupported') path = path.replace(/(\.validationRules)(?:\..*)?$/, '$1.*')
    else path = path.replace(/(\.validationRules\.)([^.[\]]+)/, (_match, prefix: string, key: string) => `${prefix}${ruleKeys.has(key) ? key : '*'}`)
    path = path.replace(/(\.calculation\.)([^.[\]]+)(.*)$/, (_match, prefix: string, key: string, suffix: string) => calculationKeys.has(key) ? `${prefix}${key}${suffix}` : `${prefix}*`)
    path = path.replace(/(^|\.)([^.[\]]+)/g, (_match, prefix: string, key: string) => `${prefix}${pathKeys.has(key) ? key : '*'}`)
    return { path, code: error.code ?? 'validation', dataType: (KNOWN_DATA_TYPES as readonly string[]).includes(error.dataType ?? '') ? error.dataType : null, ruleKey }
  }), counts: { errors: errors.length } }
}
