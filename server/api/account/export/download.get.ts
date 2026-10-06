import { z } from 'zod'
import { requireAccountAdmin } from '~/server/utils/accountLifecycle'
import { downloadAccountExport } from '~/server/utils/accountExport'
export default defineEventHandler(async event => {
  const auth = await requireAccountAdmin(event)
  const query = z.object({ id: z.string().uuid(), expires: z.string().datetime(), signature: z.string() }).parse(getQuery(event))
  setResponseHeader(event, 'content-type', 'application/gzip')
  setResponseHeader(event, 'content-disposition', 'attachment; filename="flow-datos.tar.gz"')
  setResponseHeader(event, 'cache-control', 'no-store')
  return downloadAccountExport(auth.tenantId, query.id, query.expires, query.signature)
})
