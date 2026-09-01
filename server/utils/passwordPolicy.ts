import { z } from 'zod'

// HU-ERD-83 (parte 1): requisitos minimos de contraseña - unica fuente de
// verdad, reusada por cualquier endpoint que asigne/cambie una contraseña.
// Hoy solo la usa PUT /api/auth/password (cambio de contraseña autoservicio,
// nuevo en esta HU) - la app todavia NO tiene alta/invitacion de usuarios
// desde la UI (Screen/Usuarios del .pen la dibuja, pero no tiene backend:
// hoy los usuarios solo se crean via scripts/seed*.mjs) - cuando ese flujo
// se construya, debe validar la contraseña inicial contra este mismo schema,
// nunca reinventar los requisitos.
export const PASSWORD_MIN_LENGTH = 8

export const passwordPolicySchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres`)
  .regex(/[a-zA-Z]/, 'La contraseña debe incluir al menos una letra')
  .regex(/[0-9]/, 'La contraseña debe incluir al menos un número')

/** Texto de ayuda para mostrar junto al campo de contraseña nueva en el frontend. */
export const PASSWORD_REQUIREMENTS_TEXT = `Al menos ${PASSWORD_MIN_LENGTH} caracteres, con letras y números.`
