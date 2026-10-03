import { describe, expect, it, vi } from 'vitest'
import { createError, createEvent } from 'h3'
import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import { agendaDefaults, agendaSettingsSchema, schedulesSchema, timeOffSchema } from '../../utils/agenda'
import { calculateAvailability, localInstant, localAt, type AvailabilityInput } from '../../server/utils/agendaEngine'
import { agendaPermissions, requireAgendaSession } from '../../server/utils/agendaAdmin'
const base: AvailabilityInput = {
  settings: { ...agendaDefaults }, timezone: 'America/Mexico_City', people: [{ id: 'ana', name: 'Ana' }, { id: 'bea', name: 'Bea' }],
  schedules: ['ana', 'bea'].map(userId => ({ userId, weekday: 1, startTime: '09:00', endTime: '12:00', validFrom: null, validTo: null })),
  timeOff: [], appointments: [], from: '2026-10-05', to: '2026-10-05', duration: 30, now: Date.parse('2026-10-04T12:00:00Z')
}
const calculate = (extra: Partial<AvailabilityInput> = {}) => calculateAvailability({ ...base, ...extra })
const times = (extra: Partial<AvailabilityInput> = {}) => calculate(extra).slots.filter(slot => slot.userId === 'ana').map(slot => slot.time)
describe('Motor puro de Agenda 175', () => {
  it('genera rejilla local, duración, extremos y excluye pasado', () => {
    expect(times()).toEqual(['09:00', '09:30', '10:00', '10:30', '11:00', '11:30'])
    expect(times({ duration: 60 })).toEqual(['09:00', '09:30', '10:00', '10:30', '11:00'])
    expect(times({ now: Date.parse('2026-10-05T16:10:00Z') })).toEqual(['10:30', '11:00', '11:30'])
  })
  it('respeta aviso mínimo y días máximos en fechas locales', () => {
    expect(times({ settings: { ...agendaDefaults, minNoticeMinutes: 60 }, now: Date.parse('2026-10-05T15:10:00Z') })).toEqual(['10:30', '11:00', '11:30'])
    expect(times({ settings: { ...agendaDefaults, maxDaysAhead: 1 }, now: Date.parse('2026-10-01T18:00:00Z') })).toEqual([])
    expect(() => calculate({ from: '2026-10-06', to: '2026-10-05' })).toThrow('Ventana inválida')
  })
  it('resta citas activas y margen, incluye terminadas y omite cancelada/no_asistio', () => {
    for (const state of ['agendada', 'confirmada', 'en_curso', 'terminada']) expect(times({ appointments: [{ userId: 'ana', date: base.from, time: '10:00', duration: 30, state }] })).not.toContain('10:00')
    for (const state of ['cancelada', 'no_asistio']) expect(times({ appointments: [{ userId: 'ana', date: base.from, time: '10:00', duration: 30, state }] })).toContain('10:00')
    expect(times({ settings: { ...agendaDefaults, bufferMinutes: 15 }, appointments: [{ userId: 'ana', date: base.from, time: '10:00', duration: 30, state: 'agendada' }] })).toEqual(['09:00', '11:00', '11:30'])
  })
  it('bloqueos personales, organizacionales y de todo el día con fin exclusivo', () => {
    expect(times({ timeOff: [{ userId: 'ana', startLocal: '2026-10-05T09:15', endLocal: '2026-10-05T10:15', reason: 'Ausencia', allDay: false }] })).toEqual(['10:30', '11:00', '11:30'])
    expect(calculate({ timeOff: [{ userId: null, startLocal: '2026-10-05T00:00', endLocal: '2026-10-06T00:00', reason: 'Festivo', allDay: true }] }).slots).toEqual([])
  })
  it('no cruza rangos, aplica vigencia y deduplica', () => {
    const ranges = [{ userId: 'ana', weekday: 1, startTime: '09:00', endTime: '10:00', validFrom: null, validTo: null }, { userId: 'ana', weekday: 1, startTime: '10:30', endTime: '12:00', validFrom: '2026-10-05', validTo: '2026-10-05' }]
    expect(times({ schedules: ranges, duration: 60 })).toEqual(['09:00', '10:30', '11:00'])
    expect(times({ schedules: ranges.map(row => ({ ...row, validTo: '2026-10-04' })) })).toEqual([])
  })
  it('citas cruzando medianoche ocupan también el día siguiente', () => {
    expect(times({ appointments: [{ userId: 'ana', date: '2026-10-04', time: '23:00', duration: 660, state: 'agendada' }] })).toEqual(['10:00', '10:30', '11:00', '11:30'])
    expect(times({ schedules: [{ userId: 'ana', weekday: 1, startTime: '23:00', endTime: '23:59', validFrom: null, validTo: null }], duration: 60 })).toEqual([])
  })
  it('auto reparte por menos citas del día y desempata por nombre estable', () => {
    expect(calculate().automatic[0]?.userId).toBe('ana')
    expect(calculate({ appointments: [{ userId: 'ana', date: base.from, time: '18:00', duration: 30, state: 'agendada' }] }).automatic[0]?.userId).toBe('bea')
    expect(calculate({ settings: { ...agendaDefaults, assignmentMode: 'auto' } }).slots).toEqual([])
    expect(calculate({ settings: { ...agendaDefaults, assignmentMode: 'client_chooses' } }).automatic).toEqual([])
  })
  it('DST: no ofrece horas inexistentes y usa la primera ocurrencia de repetidas', () => {
    expect(localInstant('2026-03-08T02:30', 'America/New_York')).toBeNull()
    expect(new Date(localInstant('2026-11-01T01:30', 'America/New_York')!).toISOString()).toBe('2026-11-01T05:30:00.000Z')
    const input: Partial<AvailabilityInput> = { timezone: 'America/New_York', from: '2026-03-08', to: '2026-03-08', now: Date.parse('2026-03-07T12:00:00Z'), schedules: [{ userId: 'ana', weekday: 0, startTime: '01:00', endTime: '04:00', validFrom: null, validTo: null }] }
    expect(times(input)).toEqual(['01:00', '01:30', '03:00', '03:30'])
    const fall = { ...input, from: '2026-11-01', to: '2026-11-01', now: Date.parse('2026-10-31T12:00:00Z') }
    expect(times(fall).filter(time => time === '01:30')).toHaveLength(1)
    expect(times({ ...fall, duration: 60, timeOff: [{ userId: null, startLocal: '2026-11-01T01:45', endLocal: '2026-11-01T02:00', reason: 'DST', allDay: false }] })).not.toContain('01:30')
    expect(localAt(Date.parse('2026-10-05T15:00:00Z'), base.timezone)).toBe('2026-10-05T09:00')
  })
  it('rechaza duración inválida', () => { for (const duration of [0, -1, 1.5, 1441, NaN]) expect(() => calculate({ duration })).toThrow('Duración inválida') })
})
describe('Validaciones y matriz de permisos', () => {
  it('acepta límites de ajustes y rechaza fuera de límite', () => {
    expect(agendaSettingsSchema.parse({ slotMinutes: 5, bufferMinutes: 120, minNoticeMinutes: 0, maxDaysAhead: 365 })).toMatchObject({ slotMinutes: 5 })
    for (const input of [{ slotMinutes: 4 }, { slotMinutes: 121 }, { bufferMinutes: -1 }, { maxDaysAhead: 366 }, { minNoticeMinutes: -1 }, { assignmentMode: 'otro' }]) expect(agendaSettingsSchema.safeParse(input).success).toBe(false)
  })
  it('rechaza traslapes y rangos vacíos, permite rangos pegados y vigencias separadas', () => {
    const row = { weekday: 1, startTime: '09:00', endTime: '10:00', validFrom: null, validTo: null }
    expect(schedulesSchema.safeParse([row, { ...row, startTime: '09:30' }]).success).toBe(false)
    expect(schedulesSchema.safeParse([{ ...row, endTime: '09:00' }]).success).toBe(false)
    expect(schedulesSchema.safeParse([row, { ...row, startTime: '10:00', endTime: '11:00' }]).success).toBe(true)
    expect(schedulesSchema.safeParse([{ ...row, validTo: '2026-10-01' }, { ...row, validFrom: '2026-10-02' }]).success).toBe(true)
    expect(timeOffSchema.safeParse({ userId: null, startLocal: '2026-02-30T00:00', endLocal: '2026-03-01T00:00', reason: 'x', allDay: true }).success).toBe(false)
  })
  it('Personal solo propio, Recepción/admin cualquiera, demás lectura', () => {
    expect(agendaPermissions({ id: 'a', role: 'Personal', isSystem: false }, 'a').edit).toBe(true)
    expect(agendaPermissions({ id: 'a', role: 'Personal', isSystem: false }, 'b').edit).toBe(false)
    expect(agendaPermissions({ id: 'a', role: 'Personal', isSystem: false }, null).edit).toBe(false)
    expect(agendaPermissions({ id: 'a', role: 'Recepción', isSystem: false }, 'b')).toEqual({ manage: true, edit: true, force: false })
    expect(agendaPermissions({ id: 'a', role: 'Administrador', isSystem: true }, null)).toEqual({ manage: true, edit: true, force: true })
    expect(agendaPermissions({ id: 'a', role: 'Miembro', isSystem: false }, 'a')).toEqual({ manage: false, edit: false, force: false })
  })
  it('exige sesión; una API key o actor ausente no acceden a administración', () => {
    vi.stubGlobal('createError', createError)
    try {
      const request = new IncomingMessage(new Socket())
      const event = createEvent(request, new ServerResponse(request))
      event.context.auth = { sub: 'a', roleId: 'role', tenantId: 'tenant' }
      expect(requireAgendaSession(event)).toBe(event.context.auth)
      event.context.apiKeyId = 'key'
      expect(() => requireAgendaSession(event)).toThrow('requiere una sesión')
      delete event.context.auth; delete event.context.apiKeyId
      expect(() => requireAgendaSession(event)).toThrow('No autenticado')
    } finally { vi.unstubAllGlobals() }
  })
})
