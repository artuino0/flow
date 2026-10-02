// El tamaño es global; este catálogo de tipos solo se aplica a campos con allowedTypes.
export const MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024
export const FIELD_FILE_TYPES = [
  { id: 'image/png', category: 'Imágenes', extensions: ['png'], mimeTypes: ['image/png'] },
  { id: 'image/jpeg', category: 'Imágenes', extensions: ['jpg', 'jpeg'], mimeTypes: ['image/jpeg'] },
  { id: 'image/webp', category: 'Imágenes', extensions: ['webp'], mimeTypes: ['image/webp'] },
  { id: 'image/gif', category: 'Imágenes', extensions: ['gif'], mimeTypes: ['image/gif'] },
  { id: 'image/avif', category: 'Imágenes', extensions: ['avif'], mimeTypes: ['image/avif'] },
  { id: 'image/svg+xml', category: 'Imágenes', extensions: ['svg'], mimeTypes: ['image/svg+xml'] },
  { id: 'application/pdf', category: 'PDF', extensions: ['pdf'], mimeTypes: ['application/pdf'] },
  { id: 'text/csv', category: 'Hojas de cálculo', extensions: ['csv'], mimeTypes: ['text/csv'] },
  { id: 'application/vnd.ms-excel', category: 'Hojas de cálculo', extensions: ['xls'], mimeTypes: ['application/vnd.ms-excel'] },
  { id: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', category: 'Hojas de cálculo', extensions: ['xlsx'], mimeTypes: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'] },
  { id: 'application/vnd.oasis.opendocument.spreadsheet', category: 'Hojas de cálculo', extensions: ['ods'], mimeTypes: ['application/vnd.oasis.opendocument.spreadsheet'] },
  { id: 'text/plain', category: 'Documentos de texto', extensions: ['txt'], mimeTypes: ['text/plain'] },
  { id: 'application/msword', category: 'Documentos de texto', extensions: ['doc'], mimeTypes: ['application/msword'] },
  { id: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', category: 'Documentos de texto', extensions: ['docx'], mimeTypes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'] },
  { id: 'application/vnd.oasis.opendocument.text', category: 'Documentos de texto', extensions: ['odt'], mimeTypes: ['application/vnd.oasis.opendocument.text'] },
  { id: 'application/rtf', category: 'Documentos de texto', extensions: ['rtf'], mimeTypes: ['application/rtf', 'text/rtf'] },
  { id: 'application/vnd.ms-powerpoint', category: 'Presentaciones', extensions: ['ppt'], mimeTypes: ['application/vnd.ms-powerpoint'] },
  { id: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', category: 'Presentaciones', extensions: ['pptx'], mimeTypes: ['application/vnd.openxmlformats-officedocument.presentationml.presentation'] },
  { id: 'application/vnd.oasis.opendocument.presentation', category: 'Presentaciones', extensions: ['odp'], mimeTypes: ['application/vnd.oasis.opendocument.presentation'] },
  { id: 'application/zip', category: 'Comprimidos', extensions: ['zip'], mimeTypes: ['application/zip', 'application/x-zip-compressed'] },
  { id: 'application/vnd.rar', category: 'Comprimidos', extensions: ['rar'], mimeTypes: ['application/vnd.rar', 'application/x-rar-compressed'] },
  { id: 'application/x-7z-compressed', category: 'Comprimidos', extensions: ['7z'], mimeTypes: ['application/x-7z-compressed'] },
  { id: 'application/gzip', category: 'Comprimidos', extensions: ['gz'], mimeTypes: ['application/gzip'] },
  { id: 'application/x-tar', category: 'Comprimidos', extensions: ['tar'], mimeTypes: ['application/x-tar'] },
] as const

export const FIELD_FILE_TYPE_IDS = FIELD_FILE_TYPES.map(type => type.id) as [typeof FIELD_FILE_TYPES[number]['id'], ...Array<typeof FIELD_FILE_TYPES[number]['id']>]

export function matchesAllowedFieldFileType(allowedTypes: readonly string[], file: { mimeType: string; fileName: string }): boolean {
  const dot = file.fileName.lastIndexOf('.')
  const extension = dot < 0 ? '' : file.fileName.slice(dot + 1).toLowerCase()
  return FIELD_FILE_TYPES.some(type => allowedTypes.includes(type.id)
    && (type.mimeTypes as readonly string[]).includes(file.mimeType)
    && (type.extensions as readonly string[]).includes(extension))
}
