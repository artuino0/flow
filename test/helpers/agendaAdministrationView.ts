import { computed, defineComponent, h, nextTick, onBeforeUnmount, onMounted, ref, useId, type App } from 'vue'
import { compileVueComponent } from './vueComponent'

export function registerAgendaAdministrationComponents(app: App) {
  const globals = { computed, nextTick, onBeforeUnmount, onMounted, ref, useId }
  app.component('SitesAdminPage', compileVueComponent('components/SitesAdminPage.vue'))
  app.component('ListPageHeader', compileVueComponent('components/ListPageHeader.vue'))
  app.component('ReportOptionSelect', compileVueComponent('components/ReportOptionSelect.vue', {}, globals))
  app.component('AgendaCard', compileVueComponent('components/AgendaCard.vue'))
  app.component('AgendaChoiceTiles', compileVueComponent('components/AgendaChoiceTiles.vue', {}, globals))
  app.component('ModuleTourHelpButton', { render: () => h('button', { type: 'button' }, 'Ayuda') })
  app.component('NuxtLink', defineComponent({ setup: (_, { slots, attrs }) => () => h('a', { ...attrs, href: attrs.to }, slots.default?.()) }))
}
