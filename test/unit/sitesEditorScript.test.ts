import { describe, it, expect } from 'vitest'
import { buildPreviewDocument, joinSiteScript, splitSiteScript } from '../../utils/sitesEditorScript'

describe('sitesEditorScript (ERD-87)', () => {
  it('separa el JS propio del HTML guardado', () => {
    const saved = '<p>hola</p>\n<script data-flow-site-js>\nconsole.log(1)\n</script>'
    expect(splitSiteScript(saved)).toEqual({ html: '<p>hola</p>', js: 'console.log(1)' })
  })

  it('acepta el atributo con valor y respeta otros <script>', () => {
    const saved = '<script src="x.js"></script><p>a</p><script data-flow-site-js="1" defer>go()</script>'
    expect(splitSiteScript(saved)).toEqual({ html: '<script src="x.js"></script><p>a</p>', js: 'go()' })
  })

  it('sin JS propio deja el HTML intacto', () => {
    expect(splitSiteScript('<p>sin script</p>')).toEqual({ html: '<p>sin script</p>', js: '' })
    expect(joinSiteScript('<p>a</p>', '  ')).toBe('<p>a</p>')
  })

  it('unir y separar es ida y vuelta', () => {
    const joined = joinSiteScript('<p>a</p>  ', ' run() ')
    expect(joined).toBe('<p>a</p>\n<script data-flow-site-js>\nrun()\n</script>')
    expect(splitSiteScript(joined)).toEqual({ html: '<p>a</p>', js: 'run()' })
  })

  it('la vista previa incluye CSS, HTML y el puente del editor', () => {
    const doc = buildPreviewDocument('<form data-flow-form="f"></form>', 'body{color:red}')
    expect(doc).toContain('<style>html,body{min-height:100%;margin:0}body{color:red}')
    expect(doc).toContain('<body><form data-flow-form="f"></form><script>(function(){')
    expect(doc.endsWith('</script></body></html>')).toBe(true)
    expect(doc).toContain('<meta name="color-scheme" content="light">')
    expect(doc).toContain(':root{color-scheme:light!important}')
  })
})
