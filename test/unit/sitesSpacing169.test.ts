import { readFileSync, readdirSync } from 'node:fs'
import { parse as parseVue } from '@vue/compiler-sfc'
import { parse as parseCss, type Rule } from 'postcss'
import { describe, expect, it } from 'vitest'

const pairs = [
  { file: 'components/SitesPageManager.vue', tabs: '.manager-tabs', table: '.content-table', routes: ['pages', 'landing-pages'] },
  { file: 'components/SitesFormManager.vue', tabs: '.forms-tabs', table: '.forms-table', routes: ['forms'] }
]

function declarations(file: string, selector: string, width: number) {
  const { descriptor, errors } = parseVue(readFileSync(file, 'utf8'))
  expect(errors, file).toEqual([])
  const values: Record<string, string> = {}
  for (const style of descriptor.styles) {
    parseCss(style.content).walkRules((rule: Rule) => {
      if (!rule.selectors.includes(selector)) return
      let parent = rule.parent
      while (parent && parent.type !== 'root') {
        if (parent.type === 'atrule') {
          expect(parent.name, file).toBe('media')
          const maxWidth = parent.params.match(/^\(max-width:\s*(\d+)px\)$/)
          expect(maxWidth, `${file}: ${parent.params}`).toBeTruthy()
          if (width > Number(maxWidth![1])) return
        }
        parent = parent.parent
      }
      rule.walkDecls(decl => { values[decl.prop] = decl.value })
    })
  }
  return values
}

function margin(values: Record<string, string>, side: 'top' | 'bottom') {
  const shorthand = (values.margin ?? '0').split(/\s+/)
  const value = values[`margin-${side}`] ?? shorthand[side === 'top' ? 0 : shorthand.length > 2 ? 2 : shorthand.length - 1]!
  expect(value).toMatch(/^(?:0|\d+px)$/)
  return Number.parseFloat(value)
}

describe('BUG-ERD-169: separación entre pestañas y tablas de Sites', () => {
  for (const width of [1440, 390]) {
    it.each(pairs)(`conserva 16 px en $file a ${width} px, sin duplicar márgenes`, ({ file, tabs, table }) => {
        const source = parseVue(readFileSync(file, 'utf8')).descriptor.template!.content
        expect(source).toMatch(new RegExp(`class="${tabs.slice(1)}"[\\s\\S]*?</div>\\s*<div class="${table.slice(1)}"`))
        const bottom = margin(declarations(file, tabs, width), 'bottom')
        const top = margin(declarations(file, table, width), 'top')
        expect(bottom === 0 || top === 0, file).toBe(true)
        const gap = Math.max(bottom, top)
        expect(gap, file).toBeGreaterThan(0)
        expect(gap, file).toBe(16)
    })
  }

  it('cubre global y por sitio, sin variantes de tema para el espaciado', () => {
    for (const { file, routes, tabs, table } of pairs) {
      const component = file.split('/').pop()!.replace('.vue', '')
      for (const route of routes) {
        for (const scope of ['', '[siteId]/']) {
          expect(readFileSync(`pages/sites/${scope}${route}/index.vue`, 'utf8')).toContain(`<${component}`)
        }
      }
      for (const style of parseVue(readFileSync(file, 'utf8')).descriptor.styles) {
        parseCss(style.content).walkRules(rule => {
          if (rule.selector.includes(tabs) || rule.selector.includes(table)) {
            expect(rule.selector).not.toMatch(/dark|theme-light|data-theme/)
          }
        })
      }
    }
  })

  it('detecta nuevas filas de pestañas de Sites que falten en el inventario', () => {
    const files = [
      ...readdirSync('components').filter(file => /^Sites.*\.vue$/.test(file)).map(file => `components/${file}`),
      ...readdirSync('pages/sites', { recursive: true, encoding: 'utf8' }).filter(file => file.endsWith('.vue')).map(file => `pages/sites/${file.replaceAll('\\', '/')}`)
    ]
    const found: string[] = []
    for (const file of files) {
      // Las pestañas de archivos del IDE no preceden una tabla/lista de gestión.
      if (file === 'pages/sites/[siteId]/pages/[pageId].vue') continue
      const template = parseVue(readFileSync(file, 'utf8')).descriptor.template?.content ?? ''
      if (/class="[^"\n]*\b[\w-]*tabs\b/.test(template)) found.push(file)
    }
    expect(found.sort()).toEqual(pairs.map(pair => pair.file).sort())
  })

  it('mantiene las separaciones existentes de las pantallas sin pestañas', () => {
    for (const width of [1440, 390]) {
      for (const [file, selector] of [
        ['components/SitesDomainManager.vue', '.table-wrap'],
        ['components/SitesAnalyticsSummary.vue', '.performance'],
        ['pages/sites/index.vue', '.sites-table'],
        ['pages/sites/templates.vue', '.empty-table'],
        ['pages/sites/trash.vue', '.empty-table']
      ]) expect(margin(declarations(file!, selector!, width), 'top'), file).toBe(20)
    }
    for (const file of ['pages/sites/[siteId]/publications/index.vue', 'pages/sites/[siteId]/overview/index.vue']) {
      expect(parseVue(readFileSync(file, 'utf8')).descriptor.template!.content).toContain('class="mt-5 overflow-hidden')
    }
  })
})
