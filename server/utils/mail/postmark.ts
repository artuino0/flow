import { httpTransport } from './http'
import { addresses } from './types'
export function postmarkTransport(key = process.env.POSTMARK_SERVER_TOKEN, endpoint = 'https://api.postmarkapp.com/email') {
  return httpTransport('postmark', endpoint, key, key => ({ 'X-Postmark-Server-Token': key }), m => ({
    From: m.from, To: addresses(m.to).join(','), Cc: m.cc?.join(','), Bcc: m.bcc?.join(','), ReplyTo: m.replyTo,
    Subject: m.subject, HtmlBody: m.html, TextBody: m.text, Headers: Object.entries(m.headers ?? {}).map(([Name, Value]) => ({ Name, Value })),
    Attachments: m.attachments?.map(a => ({ Name: a.filename, Content: a.content.toString('base64'), ContentType: a.contentType ?? 'application/octet-stream', ContentID: a.cid ? `cid:${a.cid}` : undefined }))
  }), r => r.ErrorCode === 0 && typeof r.MessageID === 'string' && r.MessageID ? r.MessageID : undefined)
}
