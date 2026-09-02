import nodemailer from 'nodemailer'

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

interface SmtpConfig {
  host: string
  port: number
  user: string
  password: string
  from: string
}

/**
 * Lee la configuracion SMTP de variables de entorno (ver .env.example).
 * Lanza SmtpNotConfiguredError si falta alguna - se traduce a un 500 con
 * mensaje accionable en el endpoint (server/api/users/index.post.ts), nunca
 * un fallback silencioso a "no enviar nada".
 */
function readSmtpConfig(): SmtpConfig {
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

  return { host, port: portNumber, user, password, from }
}

/**
 * Base publica de la app para armar el enlace de invitacion (ej.
 * https://app.midominio.com). Sin variable seteada, cae a localhost:3000
 * (APP_PORT, HU-ERD-13) - suficiente para desarrollo local, pero un
 * deployment real DEBE setear APP_BASE_URL o el enlace del correo apuntara
 * a una URL que el invitado no puede abrir.
 */
function getAppBaseUrl(): string {
  const raw = process.env.APP_BASE_URL
  if (raw) return raw.replace(/\/+$/, '')
  const port = process.env.APP_PORT || '3000'
  return `http://localhost:${port}`
}

export interface InvitationEmailParams {
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
export function buildInvitationEmailHtml(params: InvitationEmailParams & { inviteUrl: string }): string {
  const { tenantName, inviterName, roleName, inviteUrl, to } = params
  const year = new Date().getFullYear()
  const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  return `<!doctype html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:32px 16px;background:#EEF1F5;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr><td align="center">
      <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;background:#FFFFFF;border-radius:8px;overflow:hidden;">
        <tr><td style="padding:28px 32px 0 32px;">
          <p style="margin:0;font-size:16px;font-weight:700;color:#33475B;">ERP Dinámico</p>
        </td></tr>
        <tr><td style="padding:20px 32px 0 32px;">
          <p style="margin:0;font-size:22px;font-weight:700;color:#33475B;">Te invitaron a unirte a ${escape(tenantName)}</p>
        </td></tr>
        <tr><td style="padding:12px 32px 0 32px;">
          <p style="margin:0;font-size:14px;line-height:1.5;color:#516F90;">${escape(inviterName)} te invitó a colaborar en el espacio de trabajo de ${escape(tenantName)} en ERP Dinámico. Te vas a unir con el rol de ${escape(roleName)}.</p>
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
          <a href="${inviteUrl}" style="display:inline-block;background:#FF7A59;color:#FFFFFF;font-size:15px;font-weight:700;text-decoration:none;border-radius:6px;padding:12px 28px;">Aceptar invitación</a>
        </td></tr>
        <tr><td style="padding:12px 32px 0 32px;" align="center">
          <p style="margin:0;font-size:12px;color:#8DA1B5;">Este enlace expira en 7 días</p>
        </td></tr>
        <tr><td style="padding:20px 32px 0 32px;">
          <p style="margin:0;font-size:12px;color:#8DA1B5;">¿El botón no funciona? Copia y pega este enlace en tu navegador:</p>
          <p style="margin:4px 0 0 0;font-size:12px;font-weight:600;color:#33475B;word-break:break-all;">${escape(inviteUrl)}</p>
        </td></tr>
        <tr><td style="padding:28px 32px 28px 32px;border-top:1px solid #E5EAF0;margin-top:24px;">
          <p style="margin:24px 0 0 0;font-size:12px;color:#8DA1B5;">Este correo fue enviado a ${escape(to)} porque fue invitada a ERP Dinámico.</p>
          <p style="margin:8px 0 0 0;font-size:12px;color:#8DA1B5;">© ${year} ERP Dinámico. Todos los derechos reservados.</p>
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
  const smtp = readSmtpConfig()
  const inviteUrl = `${getAppBaseUrl()}/invitacion/${params.token}`

  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.port === 465,
    auth: { user: smtp.user, pass: smtp.password }
  })

  await transporter.sendMail({
    from: smtp.from,
    to: params.to,
    subject: `Te invitaron a unirte a ${params.tenantName} en ERP Dinámico`,
    html: buildInvitationEmailHtml({ ...params, inviteUrl })
  })
}
