import { describe, expect, it } from 'vitest'
import { JSDOM } from 'jsdom'
import { renderDesignerMarkdown } from '../../utils/designerMarkdown'
import { DESIGNER_EXPLANATION_LIMIT, limitDesignerExplanation } from '../../server/utils/moduleDesigner/explanation'

const browserWindow = new JSDOM('').window
const render = (source: string) => renderDesignerMarkdown(source, browserWindow)

describe('explicación markdown del diseñador', () => {
  it('renderiza listas, negritas y tablas pequeñas', () => {
    const html = render('### ¿Por qué?\n- **Pedidos** con partidas\n\n| Campo | Uso |\n| --- | --- |\n| Total | Suma |')
    expect(html).toContain('<h3>¿Por qué?</h3>')
    expect(html).toContain('<li><strong>Pedidos</strong> con partidas</li>')
    expect(html).toContain('<table>')
    expect(html).toContain('<td>Total</td>')
  })

  it('neutraliza scripts, atributos ejecutables, URLs javascript y HTML crudo', () => {
    const html = render('<script>alert(1)</script>\n<img src=x onerror=alert(2)>\n[abrir](javascript:alert(3))\n<div onclick="alert(4)">texto</div>')
    const root = browserWindow.document.createElement('div')
    root.innerHTML = html
    expect(root.querySelector('script, img, a, div[onclick]')).toBeNull()
    expect(root.querySelector('[onerror], [href]')).toBeNull()
    expect(html).toContain('&lt;script&gt;')
  })

  it('recorta por viñeta y conserva las advertencias dentro de 1500 caracteres', () => {
    const text = `Resumen.\n### ¿Por qué?\n${Array.from({ length: 40 }, (_, i) => `- **Módulo ${i}**: ${'decisión útil '.repeat(8)}`).join('\n')}`
    const result = limitDesignerExplanation(text, ['Descarté una regla inválida'])
    expect(result.length).toBeLessThanOrEqual(DESIGNER_EXPLANATION_LIMIT)
    expect(result).toContain('- **Ajuste automático:** Descarté una regla inválida')
    expect(result).toMatch(/- …\n- \*\*Ajuste automático/)
    expect(result).not.toMatch(/decisió…/)
  })
})
