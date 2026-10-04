import { describe, expect, it } from 'vitest'
import { isAgendaStaff } from '../../utils/agendaStaff'
import { agendaAccentPresentation, normalizeAgendaAccent } from '../../utils/agendaAccent'
import { agendaSiteSettingsSchema } from '../../utils/agendaPublic'
import { agendaReadiness } from '../../utils/agendaAdministration'
import { publicAgendaRuntime } from '../../utils/publicAgendaRuntime'

describe('Elegibilidad y acento ERD-179', () => {
  const person = { tenantId: 'tenant', isActive: true, roleName: null, isSystem: false, scheduled: false }
  it.each([
    [{ roleName: 'Personal' }, true], [{ isSystem: true }, true], [{ roleName: 'Recepción', scheduled: true }, true],
    [{ roleName: 'Recepción' }, false], [{}, false], [{ isActive: false, isSystem: true }, false], [{ tenantId: 'other', scheduled: true }, false]
  ])('selección central %j', (change, expected) => expect(isAgendaStaff({ ...person, ...change }, 'tenant')).toBe(expected))
  it.each([['#AbC', '#aabbcc'], ['#00AbEF', '#00abef']])('normaliza %s', (value, expected) => {
    expect(normalizeAgendaAccent(value)).toBe(expected)
    expect(agendaSiteSettingsSchema.parse({ accent: 'custom', accentColor: value }).accentColor).toBe(expected)
    expect(agendaAccentPresentation('custom', value).approved).toBe(true)
  })
  it.each(['#1234', '#12345678', 'red;}body{color:red', 'url(x)', 'expression(x)', 'rgb(1 2 3)', '#123456;', ' #abc', '#abc\n', 'x'.repeat(1000)])('rechaza %s sin interpolarlo', value => {
    expect(normalizeAgendaAccent(value)).toBeNull()
    expect(agendaSiteSettingsSchema.safeParse({ accent: 'custom', accentColor: value }).success).toBe(false)
    expect(agendaAccentPresentation('custom', value)).toMatchObject({ css: '', ratio: 0, approved: false })
  })
  it('mantiene configuraciones previas y rechaza personalizado sin valor', () => {
    expect(agendaSiteSettingsSchema.parse({}).accent).toBe('primary')
    for (const accent of ['primary', 'secondary', 'accent']) expect(agendaSiteSettingsSchema.safeParse({ accent }).success).toBe(true)
    expect(agendaSiteSettingsSchema.safeParse({ accent: 'custom' }).success).toBe(false)
  })
  it('ambos lados del umbral de luminancia cumplen AA, incluidos extremos', () => {
    for (let gray = 0; gray <= 255; gray++) {
      const color = '#' + gray.toString(16).padStart(2, '0').repeat(3)
      expect(agendaAccentPresentation('custom', color).ratio).toBeGreaterThanOrEqual(4.5)
    }
    expect(agendaAccentPresentation('custom', '#000').foreground).toBe('white')
    expect(agendaAccentPresentation('custom', '#fff').foreground).toBe('black')
  })
  it('serializa solo el acento normalizado en el runtime público claro', () => {
    const accent = agendaAccentPresentation('custom', '#AbC').css
    const html = publicAgendaRuntime({ site: 'site', page: 'page', locale: 'es', timezone: 'UTC', accent })
    expect(html).toContain('#aabbcc'); expect(html).toContain('--flow-agenda-accent')
    expect(html).toContain('color-scheme:light')
  })
  it('admin sin horario tiene camino propio y no exige cambiar rol', () => {
    const data = { settings: agendaSiteSettingsSchema.parse({}), available: false, reason: 'Configura horarios del personal.', services: [], people: [], ownStaff: { id: 'admin', administrator: true, scheduled: false } }
    const checklist = agendaReadiness(data, 'site', null)
    expect(checklist[2]).toMatchObject({ ready: false, label: 'Tu usuario aún no tiene horario de agenda' })
    expect(checklist[0]?.ready).toBe(true)
  })
})
