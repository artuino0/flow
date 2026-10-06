import { createServer as httpServer, type Server } from 'node:http'
import { createServer as netServer, type Socket } from 'node:net'
import type { AddressInfo } from 'node:net'
export type MailMode = 'success' | 'reject' | 'server' | 'timeout' | 'malformed'
export async function mailServer195(smtp = false) {
  const sockets = new Set<Socket>()
  let mode: MailMode = 'success'
  const requests: Array<{ path: string; headers: Record<string, unknown>; body: string }> = []
  const server = smtp ? netServer(socket => {
    if (mode === 'timeout') return
    socket.write('220 local.test ESMTP\r\n')
    let buffer = '', data = false
    socket.on('data', chunk => {
      buffer += chunk.toString()
      if (data) {
        const end = buffer.indexOf('\r\n.\r\n')
        if (end < 0) return
        requests.push({ path: '', headers: {}, body: buffer.slice(0, end) }); buffer = buffer.slice(end + 5); data = false
        socket.write(mode === 'malformed' ? 'respuesta rota\r\n' : '250 OK accepted\r\n')
      }
      while (!data && buffer.includes('\r\n')) {
        const end = buffer.indexOf('\r\n'), line = buffer.slice(0, end); buffer = buffer.slice(end + 2)
        if (/^(EHLO|HELO)/.test(line)) socket.write('250 local.test\r\n')
        else if (line.startsWith('DATA')) { data = true; socket.write('354 End with dot\r\n') }
        else if (line.startsWith('QUIT')) { socket.end('221 Bye\r\n') }
        else socket.write(mode === 'reject' ? '550 Rejected\r\n' : mode === 'server' ? '450 Busy\r\n' : '250 OK\r\n')
      }
    })
  }) : httpServer(async (request, response) => {
    let body = ''
    for await (const chunk of request) body += String(chunk)
    requests.push({ path: request.url ?? '', headers: request.headers, body })
    if (mode === 'timeout') return
    response.setHeader('Content-Type', 'application/json')
    if (mode === 'reject' || mode === 'server') {
      response.statusCode = mode === 'reject' ? 422 : 503
      response.end(JSON.stringify({ message: 'private input must never be logged' })); return
    }
    response.end(mode === 'malformed' ? '{broken' : JSON.stringify(request.url === '/resend' ? { id: 'accepted' } : request.url === '/postmark' ? { ErrorCode: 0, MessageID: 'accepted' } : request.url === '/mailtrap' ? { success: true, message_ids: ['accepted'] } : { MessageId: 'accepted' }))
  })
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)) })
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const port = (server.address() as AddressInfo).port
  return { port, url: `http://127.0.0.1:${port}`, requests, setMode(value: MailMode) { mode = value }, async stop() {
    sockets.forEach(socket => socket.destroy())
    if (!smtp) (server as Server).closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  } }
}
