import { z } from 'zod'

export const LABEL_SIZES = {
  '4x2': { label: '4 × 2 pulgadas', widthMm: 101.6, heightMm: 50.8 },
  '4x6': { label: '4 × 6 pulgadas', widthMm: 101.6, heightMm: 152.4 },
  '2x1': { label: '2 × 1 pulgadas', widthMm: 50.8, heightMm: 25.4 },
  custom: { label: 'Personalizado', widthMm: 101.6, heightMm: 50.8 }
} as const

export const labelConfigSchema = z.object({
  enabled: z.boolean(),
  showLogo: z.boolean().default(false),
  size: z.enum(['4x2', '4x6', '2x1', 'custom']),
  widthMm: z.number().min(20).max(300),
  heightMm: z.number().min(15).max(300),
  orientation: z.enum(['portrait', 'landscape']),
  copies: z.number().int().min(1).max(100).default(1),
  titleField: z.string().nullable(),
  subtitleField: z.string().nullable(),
  detailFields: z.array(z.string()).max(4),
  barcodeField: z.string().nullable(),
  barcodeFormat: z.enum(['code128', 'ean13', 'qrcode'])
})

export type LabelConfig = z.infer<typeof labelConfigSchema>

export const DEFAULT_LABEL_CONFIG: LabelConfig = {
  enabled: false,
  showLogo: false,
  size: '4x2',
  widthMm: LABEL_SIZES['4x2'].widthMm,
  heightMm: LABEL_SIZES['4x2'].heightMm,
  orientation: 'landscape',
  copies: 1,
  titleField: null,
  subtitleField: null,
  detailFields: [],
  barcodeField: null,
  barcodeFormat: 'code128'
}

export function resolveLabelConfig(input: unknown): LabelConfig {
  const parsed = labelConfigSchema.safeParse(input)
  if (!parsed.success) return { ...DEFAULT_LABEL_CONFIG }
  return { ...DEFAULT_LABEL_CONFIG, ...parsed.data }
}

const CODE128_PATTERNS = [
  '212222','222122','222221','121223','121322','131222','122213','122312','132212','221213','221312','231212','112232','122132','122231','113222','123122','123221','223211','221132','221231','213212','223112','312131','311222','321122','321221','312212','322112','322211','212123','212321','232121','111323','131123','131321','112313','132113','132311','211313','231113','231311','112133','112331','132131','113123','113321','133121','313121','211331','231131','213113','213311','213131','311123','311321','331121','312113','312311','332111','314111','221411','431111','111224','111422','121124','121421','141122','141221','112214','112412','122114','122411','142112','142211','241211','221114','413111','241112','134111','111242','121142','121241','114212','124112','124211','411212','421112','421211','212141','214121','412121','111143','111341','131141','114113','114311','411113','411311','113141','114131','311141','411131','211412','211214','211232','2331112'
]

function escapeXml(value: string) {
  return value.replace(/[<>&'"]/g, char => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[char] ?? char))
}

/** Genera un SVG Code 128-B nítido para impresoras térmicas y navegador. */
export function code128Svg(raw: unknown, height = 34): string {
  const value = String(raw ?? '').trim().slice(0, 80) || 'SIN-CODIGO'
  const codes = [104, ...Array.from(value).map(char => {
    const code = char.charCodeAt(0) - 32
    return code >= 0 && code <= 95 ? code : 0
  })]
  const checksum = codes.reduce((sum, code, index) => sum + code * (index === 0 ? 1 : index), 0) % 103
  codes.push(checksum, 106)
  const moduleWidth = 2
  let x = 0
  const bars: string[] = []
  for (const code of codes) {
    const pattern = CODE128_PATTERNS[code] ?? CODE128_PATTERNS[0]
    for (let i = 0; i < pattern.length; i++) {
      const width = Number(pattern[i]) * moduleWidth
      if (i % 2 === 0) bars.push(`<rect x="${x}" y="0" width="${width}" height="${height}"/>`)
      x += width
    }
  }
  const totalWidth = x
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalWidth} ${height}" preserveAspectRatio="none" role="img" aria-label="Código ${escapeXml(value)}"><g fill="currentColor">${bars.join('')}</g></svg>`
}
