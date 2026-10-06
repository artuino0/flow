import { requireAuth } from '~/server/utils/rbac'
import { readNavigationPins } from '~/server/utils/navigationPins'
export default defineEventHandler(event => readNavigationPins(requireAuth(event)))
