/** Alias por nombre: la biblioteca no almacena una jerarquía de directorios. */
export function siteRelativeAssetName(rawPath: string): string | null {
  if (rawPath.length > 2048 || !rawPath.startsWith('/') || rawPath.includes('\\')) return null
  let parts: string[]
  try { parts = rawPath.slice(1).split('/').map(part => decodeURIComponent(part)) } catch { return null }
  if (parts.some(part => !part || part === '.' || part === '..' || /[\u0000-\u001f\u007f\\/%<>:"|?*]/.test(part))) return null
  if (parts.length !== 1 && !(parts.length === 2 && parts[0] === 'assets')) return null
  const name = parts[parts.length - 1]!
  return name.length <= 255 ? name : null
}

export function siteRequestHasTraversal(rawUrl: string) {
  const rawPath = rawUrl.split('?')[0] ?? ''
  try {
    return rawPath.split('/').some(part => {
      const decoded = decodeURIComponent(part)
      return decoded === '.' || decoded === '..' || /[\u0000-\u001f\u007f\\/%]/.test(decoded)
    })
  } catch { return true }
}
