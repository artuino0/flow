import { z } from 'zod'
import { requireChatPermission } from '~/server/utils/chatPermissions'

const querySchema = z.object({ q: z.string().trim().min(1).max(50), offset: z.coerce.number().int().min(0).max(4999).default(0) })

export default defineEventHandler(async event => {
  await requireChatPermission(event, 'canAccess')
  const query = await getValidatedQuery(event, querySchema.parse)
  const apiKey = process.env.GIPHY_API_KEY
  if (!apiKey) throw createError({ statusCode: 503, statusMessage: 'El buscador de GIFs no está configurado' })
  const response = await $fetch<{ data?: Array<{ id: string; title?: string; images?: { fixed_width?: { url?: string; width?: string; height?: string } } }>; pagination?: { total_count?: number; count?: number } }>('https://api.giphy.com/v1/gifs/search', {
    query: { api_key: apiKey, q: query.q, lang: 'es', rating: 'g', limit: 18, offset: query.offset }
  })
  return {
    data: (response.data ?? []).map(gif => ({ id: gif.id, title: gif.title ?? 'GIF', url: gif.images?.fixed_width?.url ?? '', width: Number(gif.images?.fixed_width?.width ?? 0), height: Number(gif.images?.fixed_width?.height ?? 0) })).filter(gif => gif.url),
    total: response.pagination?.total_count ?? 0
  }
})
