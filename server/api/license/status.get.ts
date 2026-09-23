import { getLicenseStatus } from '~/server/utils/license'

export default defineEventHandler(() => getLicenseStatus())
