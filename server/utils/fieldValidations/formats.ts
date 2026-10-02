
function calendarDate(value: string): boolean {
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function validateEmail(value: string): boolean {
  const at = value.indexOf('@')
  if (at < 1 || at > 64 || at !== value.lastIndexOf('@')) return false
  const local = value.slice(0, at)
  const domain = value.slice(at + 1)
  if (!/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local) || local.startsWith('.') || local.endsWith('.') || local.includes('..')) return false
  const labels = domain.split('.')
  return labels.length >= 2 && /^[A-Za-z]{2,63}$/.test(labels[labels.length - 1]) && labels.every(label => label.length >= 1 && label.length <= 63 && /^[A-Za-z0-9-]+$/.test(label) && /^[A-Za-z0-9]$/.test(label[0]) && /^[A-Za-z0-9]$/.test(label[label.length - 1]))
}

export const TEXT_FORMATS = [
  { id: 'email', label: 'Correo electrónico', description: 'Correo ASCII sin espacios: parte local de hasta 64 caracteres, dominio con etiquetas de hasta 63 y terminación de letras; máximo total 254.', example: 'ana@example.com', maxLength: 254, validate: validateEmail },
  { id: 'phoneMx', label: 'Teléfono de México', description: 'Diez dígitos nacionales, opcionalmente +52 o 52; permite espacios y guiones entre dígitos. Sin extensiones ni paréntesis.', example: '+52 477-123-4567', maxLength: 40, validate: (s: string) => {
    if (!/^\+?\d[0-9 -]*\d$/.test(s)) return false
    const digits = s.replace(/[ -]/g, '')
    return /^\d{10}$/.test(digits) || /^(?:\+52|52)\d{10}$/.test(digits)
  } },
  { id: 'url', label: 'Dirección web', description: 'URL absoluta HTTP o HTTPS con host, sin espacios ni credenciales.', example: 'https://example.com/contacto', maxLength: 2048, validate: (s: string) => {
    if (/\s/.test(s) || !/^https?:\/\//i.test(s)) return false
    try { const url = new URL(s); return ['http:', 'https:'].includes(url.protocol) && Boolean(url.hostname) && !url.username && !url.password } catch { return false }
  } },
  { id: 'rfc', label: 'RFC', description: 'RFC de persona física (13) o moral (12), mayúsculas, fecha válida y homoclave. Verifica estructura, no inscripción fiscal.', example: 'GODE561231GR8', maxLength: 13, validate: (s: string) => {
    const match = /^[A-ZÑ&]{3,4}(\d{2})(\d{2})(\d{2})[A-Z0-9]{3}$/.exec(s)
    return Boolean(match && calendarDate(`20${match[1]}-${match[2]}-${match[3]}`))
  } },
  { id: 'curp', label: 'CURP', description: '18 caracteres en mayúsculas: letras, fecha válida, sexo H/M, clave estatal o NE, consonantes y terminación. Verifica estructura, no registro oficial.', example: 'GODE561231HDFRRN09', maxLength: 18, validate: (s: string) => {
    const match = /^[A-Z][AEIOUX][A-Z]{2}(\d{2})(\d{2})(\d{2})[HM](AS|BC|BS|CC|CL|CM|CS|CH|DF|DG|GT|GR|HG|JC|MC|MN|MS|NT|NL|OC|PL|QT|QR|SP|SL|SR|TC|TS|TL|VZ|YN|ZS|NE)[B-DF-HJ-NP-TV-Z]{3}[A-Z0-9]\d$/.exec(s)
    return Boolean(match && calendarDate(`20${match[1]}-${match[2]}-${match[3]}`))
  } },
  { id: 'postalCodeMx', label: 'Código postal de México', description: 'Exactamente cinco dígitos; conserva ceros iniciales.', example: '01234', maxLength: 5, validate: (s: string) => /^\d{5}$/.test(s) },
  { id: 'lettersOnly', label: 'Solo letras', description: 'Una o más letras Unicode, sin espacios, números ni signos.', example: 'Ángela', maxLength: 4096, validate: (s: string) => /^\p{L}+$/u.test(s) },
  { id: 'digitsOnly', label: 'Solo dígitos', description: 'Uno o más dígitos ASCII, sin espacios ni signos.', example: '00123', maxLength: 4096, validate: (s: string) => /^\d+$/.test(s) },
  { id: 'alphanumeric', label: 'Letras y números', description: 'Letras Unicode y dígitos ASCII, sin espacios ni signos.', example: 'Árbol123', maxLength: 4096, validate: (s: string) => /^[\p{L}0-9]+$/u.test(s) }
] as const

export function validateTextFormat(id: string, value: string): boolean {
  const format = TEXT_FORMATS.find(item => item.id === id)
  if (!format || value.length > format.maxLength) return false
  const normalized = value.normalize('NFC')
  return normalized.length <= format.maxLength && format.validate(normalized)
}
