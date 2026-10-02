import { writeFileSync } from 'node:fs'
import { lightTokens, darkTokens, rgbChannels } from '../utils/themeTokens'

const declarations = (tokens: Record<string, string>, important = false) => Object.entries(tokens)
  .map(([name, value]) => `  --brand-${name}: ${rgbChannels(value)}${important ? ' !important' : ''};`).join('\n')

writeFileSync(new URL('../assets/css/theme.css', import.meta.url), `/* Generado por scripts/generateThemeCss.ts; fuente: utils/themeTokens.ts. */
:root {\n${declarations(lightTokens)}\n  color-scheme: light;\n}
:root[data-theme="dark"], .dark {\n${declarations(darkTokens)}\n  color-scheme: dark;\n}
.theme-light, body[data-content-theme="light"] > :not(#__nuxt):not([data-theme-shell]):not(.driver-popover):not(.driver-overlay) {\n${declarations(lightTokens)}\n  color-scheme: light;\n  color: rgb(var(--brand-body-text));\n}
@media print {
  :root, :root[data-theme="dark"], .dark, .theme-light {\n${declarations(lightTokens, true)}\n    color-scheme: light !important;\n  }
}
.flow-mark-dark { display: none; }
:root[data-theme="dark"] .flow-mark-light, .dark .flow-mark-light { display: none; }
:root[data-theme="dark"] .flow-mark-dark, .dark .flow-mark-dark { display: block; }
`)
