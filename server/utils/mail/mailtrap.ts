import { httpTransport } from './http'
import { address, addresses } from './types'
export function mailtrapTransport(key = process.env.MAILTRAP_API_TOKEN, inbox = process.env.MAILTRAP_INBOX_ID, endpoint?: string) {
  const mode = process.env.MAILTRAP_MODE || 'sandbox'
  const transport = httpTransport('mailtrap', endpoint ?? (mode === 'sandbox' ? `https://sandbox.api.mailtrap.io/api/send/${inbox ?? ''}` : 'https://send.api.mailtrap.io/api/send'),
    key, key => ({ Authorization: `Bearer ${key}` }), m => ({ from: address(m.from), to: addresses(m.to).map(address), cc: m.cc?.map(address), bcc: m.bcc?.map(address),
      reply_to: m.replyTo ? address(m.replyTo) : undefined, subject: m.subject, html: m.html, text: m.text, headers: m.headers,
      attachments: m.attachments?.map(a => ({ filename: a.filename, content: a.content.toString('base64'), type: a.contentType, disposition: a.cid ? 'inline' : 'attachment', content_id: a.cid }))
    }), r => r.success === true && Array.isArray(r.message_ids) && typeof r.message_ids[0] === 'string' ? r.message_ids[0] : undefined)
  const check = transport.check
  transport.check = async () => !['sandbox', 'sending'].includes(mode) || (mode === 'sandbox' && !inbox && !endpoint)
    ? { status: 'misconfigured', reason: 'Configura MAILTRAP_MODE (sandbox o sending) y MAILTRAP_INBOX_ID para sandbox.' } : check()
  return transport
}
