import { describe, expect, it } from 'vitest'
import { agendaBrowserHeaders } from '../helpers/agendaBrowserFetch'

describe('Cabeceras de navegador de Agenda 180', () => {
  const url = 'https://citas.example.test/agenda-manage/s/p#agenda=secreto'
  it('GET mismo origen no envía Origin y no-referrer tampoco envía Referer', () => {
    const headers = agendaBrowserHeaders(url, '/api/public/agenda/slots', { referrerPolicy: 'no-referrer', headers: { Origin: 'inventado', Referer: url } })
    expect(headers.origin).toBeUndefined(); expect(headers.referer).toBeUndefined()
    expect(headers).toMatchObject({ 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'empty' })
  })
  it('same-origin retira fragmento y credenciales, y nunca remite Referer a otro origen', () => {
    const headers = agendaBrowserHeaders(url, '/api/public/agenda/booking', { referrerPolicy: 'same-origin' })
    expect(headers.referer).toBe('https://citas.example.test/agenda-manage/s/p'); expect(headers.origin).toBeUndefined()
    expect(agendaBrowserHeaders(url, 'https://ajeno.test/api', { referrerPolicy: 'same-origin' }).referer).toBeUndefined()
    expect(agendaBrowserHeaders('https://u:clave@citas.example.test/#token', '/api', { referrerPolicy: 'same-origin' }).referer).toBe('https://citas.example.test/')
  })
  it.each(['book', 'cancel', 'reschedule'])('POST %s envía Origin con documento no-referrer', path => {
    expect(agendaBrowserHeaders(url, '/api/public/agenda/' + path, { method: 'POST', referrerPolicy: 'no-referrer' })).toMatchObject({ origin: 'https://citas.example.test', 'sec-fetch-site': 'same-origin' })
  })
})
