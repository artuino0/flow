// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import * as vue from 'vue'
import type { App, Component } from 'vue'
import { readFileSync } from 'node:fs'
import { compileVueComponent } from '../helpers/vueComponent'

const apps: App[] = []
const pill = compileVueComponent('components/OrganizationBrandPill.vue', {}, vue)
const flush = async () => { await Promise.resolve(); await vue.nextTick() }

function mount(component: Component, props: Record<string, unknown>) {
  const host = document.createElement('div')
  document.body.append(host)
  const app = vue.createApp({ render: () => vue.h(component, props) })
  app.component('NuxtLink', vue.defineComponent({
    props: ['to'],
    setup: (linkProps, { attrs, slots }) => () => vue.h('a', { ...attrs, href: linkProps.to }, slots.default?.())
  }))
  app.mount(host)
  apps.push(app)
  return host
}

afterEach(() => { apps.splice(0).forEach(app => app.unmount()); document.body.innerHTML = '' })

describe('HU-ERD-204: marca de organización junto a Flow', () => {
  it('muestra el logo de organización sobre superficie neutra y enlaza al admin a identidad visual', async () => {
    const host = mount(pill, { organizationName: 'Grupo Agrícola Salmantino', hasLogo: true, isAdmin: true })
    await flush()
    const link = host.querySelector('a')
    expect(link?.getAttribute('href')).toBe('/ajustes?section=identidad')
    expect(link?.getAttribute('title')).toBe('Grupo Agrícola Salmantino')
    expect(link?.querySelector('img')?.getAttribute('src')).toBe('/api/tenant/logo')
    expect(link?.querySelector('img')?.parentElement?.classList.contains('theme-light')).toBe(true)
    expect(link?.textContent).toContain('Grupo Agrícola Salmantino')
  })

  it('muestra las iniciales al no haber logo', async () => {
    const host = mount(pill, { organizationName: 'Grupo Agrícola Salmantino', hasLogo: false, isAdmin: false })
    await flush()
    expect(host.querySelector('img')).toBeNull()
    expect(host.textContent).toContain('GA')
    expect(host.querySelector('a')).toBeNull()
  })

  it('trunca nombres largos y conserva el nombre completo en title', async () => {
    const name = 'Organización de Operaciones Agrícolas del Noroeste y Asociados'
    const host = mount(pill, { organizationName: name, hasLogo: false, isAdmin: false })
    await flush()
    expect(host.querySelector('[title]')?.getAttribute('title')).toBe(name)
    expect(host.querySelector('span.truncate')?.className).toContain('sm:max-w-[180px]')
  })

  it('mantiene el nombre accesible pero visualmente oculto en móvil y visible desde 640 px', async () => {
    const host = mount(pill, { organizationName: 'Organización Norte', hasLogo: false, isAdmin: false })
    await flush()
    const name = host.querySelector('span.truncate')
    expect(name?.classList.contains('sr-only')).toBe(true)
    expect(name?.classList.contains('sm:not-sr-only')).toBe(true)
  })

  it('integra el dato disponible en la sesión y oculta la píldora sin organización o en rutas excluidas/editor', () => {
    const layout = readFileSync('layouts/default.vue', 'utf8')
    const authUser = readFileSync('server/utils/authUser.ts', 'utf8')
    expect(layout).toContain('user.value.tenantName?.trim()')
    expect(layout).toContain("!['/registro', '/login', '/elegir-plan'].includes(navRoute.path)")
    expect(layout).toContain('!editorFullscreen.value')
    expect(layout).toContain(':has-logo="user.tenantHasLogo"')
    expect(authUser).toContain('tenantHasLogo: sql<boolean>')
    expect(authUser).toContain('t.logo_storage_key IS NOT NULL AS "tenantHasLogo"')
    expect(authUser).not.toContain('logoStorageKey: tenants.logoStorageKey')
  })
})
