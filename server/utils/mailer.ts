import nodemailer from 'nodemailer'
import fs from 'node:fs'
import path from 'node:path'
import { getManagedTenantLogo, readManagedTenantLogo } from '~/server/utils/managedStorage'
import { eq } from 'drizzle-orm'
import { db, withTenant } from '~/server/db'
import { tenantEmailSettings } from '~/server/db/schema'
import { decryptSetting } from '~/server/utils/settingsCrypto'

// HU-ERD-84: utilidad SMTP minima para el correo de invitacion de usuarios.
// La plataforma no tenia NINGUNA capacidad de enviar correos reales hasta
// esta HU (ERD-50 "envio de email" seguia en el backlog) - el usuario eligio
// explicitamente "SMTP real ahora" (AskUserQuestion, 2026-09-02) en vez de un
// enlace manual que el admin copia/pega, asi que esta primera entrega asume
// un SMTP real configurado via variables de entorno.
//
// Mismo criterio que appConfig.ts (HU-ERD-35): funciones que leen
// directamente de process.env, sin pasar por useRuntimeConfig()/contexto de
// Nitro - son server-only, no cambian durante la vida del proceso, y asi se
// pueden testear con vitest normal sin mockear Nuxt.
//
// Diseno real (Email/Invitación Usuario en ERPDinamico.pen, revisado con las
// herramientas de Pencil junto con Screen/Usuarios) - copy y estructura
// tomados tal cual del .pen, incluida la ruta del enlace de aceptacion
// (app.erpdinamico.com/invitacion/<token>, nodo hOZJI) que fija la
// convencion real de ruta: /invitacion/:token, NO /aceptar-invitacion?token=.

export class SmtpNotConfiguredError extends Error {}

/**
 * Escape HTML minimo (&, <, >) - compartido por cualquier lugar que arme un
 * correo HTML con datos que no controlamos (nombre de usuario, valores de un
 * record, etc.). Exportado (HU-ERD-50) para que server/utils/triggerActions.ts
 * lo reuse al interpolar variables de un record en la plantilla de la accion
 * "email", en vez de duplicar la misma regla de escapado.
 */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export interface SmtpConfig {
  host: string
  port: number
  user: string
  password: string
  from: string
  fromName?: string
  replyTo?: string
  security?: 'tls' | 'ssl' | 'none'
}

/**
 * Lee la configuracion SMTP de variables de entorno (ver .env.example).
 * Lanza SmtpNotConfiguredError si falta alguna - se traduce a un 500 con
 * mensaje accionable en el endpoint (server/api/users/index.post.ts), nunca
 * un fallback silencioso a "no enviar nada".
 */
export function readSmtpConfig(): SmtpConfig {
  const host = process.env.SMTP_HOST
  const port = process.env.SMTP_PORT
  const user = process.env.SMTP_USER
  const password = process.env.SMTP_PASSWORD
  const from = process.env.SMTP_FROM

  if (!host || !port || !user || !password || !from) {
    throw new SmtpNotConfiguredError(
      'El envio de correo no esta configurado en este servidor. Completa SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD y SMTP_FROM en el archivo .env.'
    )
  }

  const portNumber = Number(port)
  if (!Number.isInteger(portNumber) || portNumber <= 0) {
    throw new SmtpNotConfiguredError(`SMTP_PORT invalido: "${port}"`)
  }

  return { host, port: portNumber, user, password, from: from.replace(/^FlowERP(?=\s*<)/, 'Flow'), security: portNumber === 465 ? 'ssl' : 'tls' }
}

/** Resuelve la configuración personalizada del tenant y cae al .env cuando
 * no existe una fila válida. Los endpoints de Ajustes usan la misma función
 * para que probar y enviar nunca tengan reglas distintas. */
export async function resolveSmtpConfig(tenantId?: string): Promise<SmtpConfig> {
  if (tenantId) {
    try {
      const row = await withTenant(tenantId, async (tx) => {
        const [value] = await tx.select().from(tenantEmailSettings).where(eq(tenantEmailSettings.tenantId, tenantId)).limit(1)
        return value ?? null
      })
      if (row) {
        if (row.provider !== 'smtp') throw new SmtpNotConfiguredError(`El proveedor "${row.provider}" todavía no está disponible`)
        if (!row.host || !row.port || !row.username || !row.passwordEncrypted) {
          throw new SmtpNotConfiguredError('La configuración SMTP personalizada está incompleta')
        }
        return {
          host: row.host,
          port: row.port,
          user: row.username,
          password: decryptSetting(row.passwordEncrypted),
          from: row.fromEmail,
          fromName: row.fromName ?? undefined,
          replyTo: row.replyTo ?? undefined,
          security: (row.security as SmtpConfig['security']) || 'tls'
        }
      }
    } catch (error) {
      if (error instanceof SmtpNotConfiguredError) throw error
      // Una instalación que todavía no aplicó la migración puede seguir
      // enviando con el .env; cualquier otro error de configuración se
      // traduce al mismo fallback seguro.
    }
  }
  return readSmtpConfig()
}

/**
 * Base publica de la app para armar el enlace de invitacion (ej.
 * https://app.midominio.com). Sin variable seteada, cae a localhost:3000
 * (APP_PORT, HU-ERD-13) - suficiente para desarrollo local, pero un
 * deployment real DEBE setear APP_BASE_URL o el enlace del correo apuntara
 * a una URL que el invitado no puede abrir. En local el valor por defecto
 * coincide con el puerto de desarrollo de Flow (3001).
 */
export function getAppBaseUrl(): string {
  const raw = process.env.APP_BASE_URL?.trim()
  const deployedOnVercel = Boolean(process.env.VERCEL || process.env.VERCEL_ENV || process.env.NUXT_ENV_VERCEL_ENV)
  const configuredIsLocal = raw ? /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?(?:\/|$)/i.test(raw) : false
  if (raw && !(deployedOnVercel && configuredIsLocal)) return raw.replace(/\/+$/, '')

  const vercelHost = process.env.NUXT_ENV_VERCEL_PROJECT_PRODUCTION_URL
    || process.env.VERCEL_PROJECT_PRODUCTION_URL
    || process.env.NUXT_ENV_VERCEL_URL
    || process.env.VERCEL_URL
  if (vercelHost) return `https://${vercelHost.replace(/^https?:\/\//i, '').replace(/\/+$/, '')}`

  const port = process.env.APP_PORT || '3001'
  return `http://localhost:${port}`
}

interface EmailLogo {
  src: string
  attachments: Array<{ filename: string; path?: string; content?: Buffer; contentType?: string; cid: string }>
}

async function resolveEmailLogo(tenantId?: string): Promise<EmailLogo> {
  if (tenantId) {
    const logo = await getManagedTenantLogo(tenantId).catch(() => null)
    if (logo) {
      const content = await readManagedTenantLogo(logo.storageKey).catch(() => null)
      if (content) {
        return {
          src: 'cid:flowerp-tenant-logo',
          attachments: [{ filename: logo.fileName, content, contentType: logo.mimeType, cid: 'flowerp-tenant-logo' }]
        }
      }
    }
  }

  const defaultLogoPath = process.env.FLOWERP_DEFAULT_LOGO_PATH || path.join(process.cwd(), 'public', 'brand', 'isotipo.png')
  return fs.existsSync(defaultLogoPath)
    ? { src: 'cid:flowerp-default-logo', attachments: [{ filename: 'flow-isotipo.png', path: defaultLogoPath, cid: 'flowerp-default-logo' }] }
    : { src: '', attachments: [] }
}

function emailBrand(logoSrc: string): string {
  if (!logoSrc) return '<span style="font-size:22px;font-weight:700;color:#0091AE;">Flow</span>'
  if (logoSrc === 'cid:flowerp-default-logo') {
    return `<img src="${logoSrc}" alt="" style="display:inline-block;vertical-align:middle;width:32px;height:32px;"><span style="display:inline-block;vertical-align:middle;margin-left:8px;font-size:22px;font-weight:700;color:#0091AE;">Flow</span>`
  }
  return `<img src="${escapeHtml(logoSrc)}" alt="Flow" style="display:block;max-width:150px;max-height:42px;width:auto;height:auto;">`
}

export interface InvitationEmailParams {
  tenantId?: string
  to: string
  tenantName: string
  inviterName: string
  roleName: string
  token: string
}

/**
 * Arma el HTML del correo de invitacion, fiel al diseno real (copy exacto
 * tomado del .pen: titulo, cuerpo, tarjeta de rol asignado, boton, nota de
 * expiracion de 7 dias, enlace alternativo, y pie con el destinatario real).
 * Estilos inline (no clases) porque los clientes de correo no soportan
 * hojas de estilo externas ni, en general, Tailwind - colores tomados 1:1
 * de tailwind.config.ts (brand.orange, brand.text, etc.) para que el correo
 * se vea consistente con el resto de la app.
 */
export function buildInvitationEmailHtml(params: InvitationEmailParams & { inviteUrl: string; logoSrc?: string }): string {
  const { tenantName, inviterName, roleName, inviteUrl, to, logoSrc = '' } = params
  const year = new Date().getFullYear()
  const escape = escapeHtml

  return `<!doctype html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:32px 16px;background:#EEF1F5;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr><td align="center">
      <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;background:#FFFFFF;border-radius:8px;overflow:hidden;">
        <tr><td style="padding:28px 32px 0 32px;">
          <p style="margin:0;font-size:16px;font-weight:700;color:#33475B;">${emailBrand(logoSrc)}</p>
        </td></tr>
        <tr><td style="padding:20px 32px 0 32px;">
          <p style="margin:0;font-size:22px;font-weight:700;color:#33475B;">Te invitaron a unirte a ${escape(tenantName)}</p>
        </td></tr>
        <tr><td style="padding:12px 32px 0 32px;">
          <p style="margin:0;font-size:14px;line-height:1.5;color:#516F90;">${escape(inviterName)} te invitó a colaborar en el espacio de trabajo de ${escape(tenantName)} en Flow. Te vas a unir con el rol de ${escape(roleName)}.</p>
        </td></tr>
        <tr><td style="padding:20px 32px 0 32px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F5F8FA;border-radius:6px;">
            <tr>
              <td style="padding:12px 16px;font-size:12px;font-weight:600;color:#8DA1B5;">Rol asignado</td>
              <td style="padding:12px 16px;font-size:12px;font-weight:600;color:#33475B;text-align:right;">${escape(roleName)}</td>
            </tr>
          </table>
        </td></tr>
        <tr><td style="padding:24px 32px 0 32px;" align="center">
          <a href="${escape(inviteUrl)}" target="_blank" rel="noopener noreferrer" style="display:inline-block;background:#FF7A59;color:#FFFFFF;font-size:15px;font-weight:700;text-decoration:none;border-radius:6px;padding:12px 28px;">Aceptar invitación</a>
        </td></tr>
        <tr><td style="padding:12px 32px 0 32px;" align="center">
          <p style="margin:0;font-size:12px;color:#8DA1B5;">Este enlace expira en 7 días</p>
        </td></tr>
        <tr><td style="padding:20px 32px 28px 32px;">
          <p style="margin:0;font-size:12px;color:#8DA1B5;">¿El botón no funciona? Copia y pega este enlace en tu navegador:</p>
          <p style="margin:4px 0 0 0;font-size:12px;font-weight:600;line-height:1.45;word-break:break-all;"><a href="${escape(inviteUrl)}" target="_blank" rel="noopener noreferrer" style="color:#33475B;text-decoration:none;">${escape(inviteUrl)}</a></p>
        </td></tr>
        <tr><td style="padding:18px 32px 22px 32px;border-top:1px solid #E5EAF0;">
          <p style="margin:0;font-size:12px;color:#8DA1B5;">Este correo fue enviado a ${escape(to)} porque fue invitada a Flow.</p>
          <p style="margin:8px 0 0 0;font-size:12px;color:#8DA1B5;">© ${year} Flow. Todos los derechos reservados.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}

/**
 * Envia el correo de invitacion real via SMTP. `token` es el token CRUDO
 * (nunca el hash guardado en users.invitationTokenHash) - server/utils/users.ts
 * lo genera, lo hashea para guardar, y pasa el crudo solo aca, que nunca lo
 * persiste (createTransport/sendMail no tocan la base).
 */
export async function sendInvitationEmail(params: InvitationEmailParams): Promise<void> {
  const smtp = await resolveSmtpConfig(params.tenantId)
  const inviteUrl = `${getAppBaseUrl()}/invitacion/${params.token}`

  const transporter = createTransporter(smtp)

  const emailLogo = await resolveEmailLogo(params.tenantId)
  await transporter.sendMail({
    from: smtp.from,
    replyTo: smtp.replyTo,
    to: params.to,
    subject: `Te invitaron a unirte a ${params.tenantName} en Flow`,
    html: buildInvitationEmailHtml({ ...params, inviteUrl, logoSrc: emailLogo.src }),
    attachments: emailLogo.attachments
  })
}

export function createTransporter(smtp: SmtpConfig) {
  return nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.security === 'ssl' || (!smtp.security && smtp.port === 465),
    requireTLS: smtp.security === 'tls',
    auth: { user: smtp.user, pass: smtp.password }
  })
}

export interface PlainEmailParams {
  tenantId?: string
  to: string
  subject: string
  html: string
  recordUrl?: string
}

/** Marco común para todos los correos transaccionales de Flow. */
export function buildGeneralEmailHtml(params: PlainEmailParams & { logoSrc?: string }): string {
  const logoSrc = params.logoSrc ?? ''
  const detail = params.recordUrl ? `<p style="margin:24px 0 0;text-align:center;"><a href="${escapeHtml(params.recordUrl)}" style="display:inline-block;background:#FF7A59;color:#FFFFFF;font-size:14px;font-weight:700;text-decoration:none;border-radius:6px;padding:11px 22px;">Ver detalle del registro</a></p><p style="margin:10px 0 0;text-align:center;font-size:12px;color:#8DA1B5;">Si el botón no funciona, copia este enlace:<br><span style="word-break:break-all;color:#33475B;">${escapeHtml(params.recordUrl)}</span></p>` : ''
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0;padding:32px 16px;background:#EEF1F5;font-family:Arial,Helvetica,sans-serif;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center"><table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;background:#FFFFFF;border-radius:8px;overflow:hidden;"><tr><td style="padding:28px 32px 20px;border-bottom:1px solid #E5EAF0;">${emailBrand(logoSrc)}</td></tr><tr><td style="padding:28px 32px;color:#33475B;font-size:14px;line-height:1.6;">${params.html}${detail}</td></tr><tr><td style="padding:20px 32px 28px;border-top:1px solid #E5EAF0;color:#8DA1B5;font-size:12px;line-height:1.5;">Este correo fue enviado a ${escapeHtml(params.to)} desde Flow.</td></tr></table></td></tr></table></body></html>`
}

/**
 * Envio de correo generico (sin plantilla propia) - HU-ERD-50, usado por la
 * accion "email" de un trigger (server/utils/triggerActions.ts), que arma su
 * propio HTML interpolando variables del record. Usa la configuración SMTP
 * personalizada del tenant y cae a las variables de entorno si no existe.
 */
export async function sendPlainEmail(params: PlainEmailParams): Promise<void> {
  const smtp = await resolveSmtpConfig(params.tenantId)
  const transporter = createTransporter(smtp)
  const emailLogo = await resolveEmailLogo(params.tenantId)
  await transporter.sendMail({
    from: smtp.from,
    replyTo: smtp.replyTo,
    to: params.to,
    subject: params.subject,
    html: buildGeneralEmailHtml({ ...params, logoSrc: emailLogo.src }),
    attachments: emailLogo.attachments
  })
}


