import { z } from 'zod'
import { normalizeAgendaAccent, agendaAccentPresentation } from './agendaAccent'
import { agendaDate, agendaTime } from './agenda'

const plain = (max: number) => z.string().trim().max(max).refine(value => !/[<>\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value), 'Texto inválido')
export function normalizeAgendaPhone(value: string) { return value.replace(/[\s()+.-]/g, '') }
export const publicId = z.string().regex(/^[a-f0-9]{32}$/)
const context = { site: z.string().uuid(), page: z.string().uuid() }
const services = z.array(publicId).min(1).max(30).refine(ids => new Set(ids).size === ids.length)
const selection = { services, date: agendaDate, time: agendaTime, personal: z.union([publicId, z.literal('any')]) }
export const publicSlotsSchema = z.object({ ...context, service: publicId.optional(), personal: z.union([publicId, z.literal('any')]).optional(), from: agendaDate, to: agendaDate }).strict()
  .refine(value => value.from <= value.to && Date.parse(value.to) - Date.parse(value.from) <= 13 * 86400000, 'Rango inválido')
export const publicBookSchema = z.object({ ...context, ...selection,
  client: z.object({ name: plain(160), email: z.string().trim().max(254).toLowerCase().email().or(z.literal('')).default(''),
    phone: z.string().max(40).transform(normalizeAgendaPhone).refine(value => value === '' || /^\d{7,15}$/.test(value)).default('') }).strict(),
  _flow_honeypot: z.string().max(200).default(''), formToken: z.string().max(200), consent: z.boolean().default(false)
}).strict()
export const publicTokenSchema = z.object({ ...context, token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).strict()
export const publicRescheduleSchema = publicTokenSchema.extend(selection).strict()
export const publicBookingQuerySchema = z.object(context).strict()
export const agendaSiteSettingsSchema = z.object({
  enabled: z.boolean().default(false), serviceIds: z.array(z.string().uuid()).max(100).default([]), personalIds: z.array(z.string().uuid()).max(100).default([]),
  assignmentMode: z.enum(['client_chooses', 'auto', 'both']).nullable().default(null),
  requiredFields: z.array(z.enum(['name', 'phone', 'email'])).max(3).default(['name', 'email']),
  visibleFields: z.array(z.enum(['name', 'phone', 'email'])).max(3).default(['name', 'phone', 'email']),
  clientFields: z.object({ name: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/).default('nombre'), phone: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/).default('telefono'), email: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/).default('correo') }).strict().default({}),
  cancellationHours: z.number().int().min(0).max(8760).default(24), maxActiveBookings: z.number().int().min(1).max(20).default(3),
  requireConsent: z.boolean().default(false), confirmationMessage: plain(2000).default('Tu cita quedó agendada.'),
  accent: z.enum(['primary', 'secondary', 'accent', 'custom']).default('primary'),
  accentColor: z.string().max(7).transform(value => normalizeAgendaAccent(value)).refine((value): value is string => value !== null, 'Escribe un color hexadecimal #RGB o #RRGGBB válido').optional()
}).strict().refine(value => agendaAccentPresentation(value.accent, value.accentColor).approved, 'El acento necesita un color válido con contraste AA').refine(value => new Set(Object.values(value.clientFields)).size === 3, 'Campos duplicados')
  .refine(value => value.requiredFields.every(field => value.visibleFields.includes(field)), 'Los campos obligatorios deben solicitarse al cliente')
  .refine(value => value.visibleFields.includes('email') || value.visibleFields.includes('phone'), 'Solicita al menos correo o teléfono')
export type AgendaSiteConfig = z.infer<typeof agendaSiteSettingsSchema>
export type PublicBook = z.infer<typeof publicBookSchema>
export type PublicReschedule = z.infer<typeof publicRescheduleSchema>
