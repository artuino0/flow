import { sendSitePreview } from '~/server/utils/publicSiteResponse'
export default defineEventHandler(event => sendSitePreview(event, getRouterParam(event, 'siteId')!))