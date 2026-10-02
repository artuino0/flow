import { requireAuth } from '~/server/utils/rbac'
import { describeFieldValidations } from '~/server/utils/fieldValidations/registry'

export default defineEventHandler(event => {
  requireAuth(event)
  return describeFieldValidations()
})
