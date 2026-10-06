import { httpTransport } from './http'
import { addresses } from './types'
export function resendTransport(key = process.env.RESEND_API_KEY, endpoint = 'https://api.resend.com/emails') {
  return httpTransport('resend', endpoint, key, key => ({ Authorization: `Bearer ${key}` }), m => ({
    from: m.from, to: addresses(m.to), cc: m.cc, bcc: m.bcc, reply_to: m.replyTo, subject: m.subject, html: m.html, text: m.text,
    headers: m.headers, attachments: m.attachments?.map(a => ({ filename: a.filename, content: a.content.toString('base64'), content_type: a.contentType, content_id: a.cid }))
  }), r => typeof r.id === 'string' && r.id ? r.id : undefined)
}
