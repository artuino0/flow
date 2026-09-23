import { describe, expect, it } from 'vitest'
import { resolveNotificationActionUrl } from '../../utils/notificationAction'

describe('resolveNotificationActionUrl', () => {
  it('conserva las rutas internas', () => {
    expect(resolveNotificationActionUrl('/registros/prospectos/abc', 'https://flow.example.com'))
      .toBe('/registros/prospectos/abc')
  })

  it('repara enlaces históricos de localhost usando la instancia abierta', () => {
    expect(resolveNotificationActionUrl(
      'http://localhost:3001/registros/prospectos/abc?tab=activity#detalle',
      'https://flow-roan-pi.vercel.app'
    )).toBe('/registros/prospectos/abc?tab=activity#detalle')
  })

  it('conserva enlaces externos reales', () => {
    expect(resolveNotificationActionUrl('https://docs.example.com/guia', 'https://flow.example.com'))
      .toBe('https://docs.example.com/guia')
  })
})
