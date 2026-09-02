import { generateSecret, generateURI, verify } from 'otplib'
import { toDataURL } from 'qrcode'

// HU-ERD-83 (parte 2): 2FA por TOTP (RFC 6238) via `otplib` v13 (API
// funcional basada en plugins, sin el objeto `authenticator` de versiones
// anteriores de la libreria). Genera el secreto en base32, arma la URI
// `otpauth://` que cualquier app autenticadora (Google Authenticator, Authy,
// etc.) sabe leer, y verifica codigos de 6 digitos con una tolerancia de
// ±30s (un paso de tiempo, cubre el desfasaje de reloj tipico entre el
// telefono y el servidor - mismo criterio que el default de versiones
// anteriores de la libreria). `qrcode` renderiza esa URI como un PNG en un
// data: URL - se muestra en la pantalla "Mi cuenta" para escanear con la
// app, junto con el secreto en texto plano como alternativa de carga manual
// (estandar en cualquier flujo de 2FA, para cuando escanear no es una opcion).

const ISSUER = 'ERP Dinamico'
const EPOCH_TOLERANCE_SECONDS = 30

export function generateTotpSecret(): string {
  return generateSecret()
}

export function totpKeyUri(secret: string, email: string): string {
  return generateURI({ issuer: ISSUER, label: email, secret })
}

export async function verifyTotpCode(secret: string, code: string): Promise<boolean> {
  if (!/^\d{6}$/.test(code)) return false
  try {
    const result = await verify({ secret, token: code, epochTolerance: EPOCH_TOLERANCE_SECONDS })
    return result.valid
  } catch {
    return false
  }
}

export function totpQrCodeDataUrl(otpauthUrl: string): Promise<string> {
  return toDataURL(otpauthUrl)
}
