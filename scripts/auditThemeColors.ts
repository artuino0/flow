import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

/** Lista cerrada: cascarón HU-161, registros HU-162, ajustes HU-163 y módulos/chat HU-164. */
export const migratedThemeFiles = [
  'components/AgendaBaseModal.vue',
  // HU-172: acceso temático; identidad de Flow en assets intactos.
  'assets/css/access.css', 'pages/login.vue', 'pages/registro.vue',
  'pages/registro-completo.vue', 'pages/recuperar.vue', 'pages/restablecer/[token].vue',
  'pages/activar.vue', 'pages/verificar-correo.vue', 'pages/confirmar-correo.vue',
  'pages/invitacion/[token].vue',
  'app.vue', 'assets/css/main.css', 'layouts/default.vue', 'pages/index.vue',
  'components/AppNav.vue', 'components/AppNavEntity.vue', 'components/AppNavGroup.vue', 'components/AppNavTooltip.vue',
  'components/ChattitoHelp.vue', 'components/ChattitoPanel.vue', 'components/ChattitoToggle.vue',
  'components/FlowAppLauncher.vue', 'components/GlobalSearch.vue', 'components/NotificationCenter.vue',
  'components/InactivityWarningModal.vue', 'components/SettingsConfirmDialog.vue', 'components/SidebarPlanUsage.vue',
  'components/ThemeSelector.vue', 'components/ToastContainer.vue', 'components/ListPageHeader.vue', 'components/PanelResizeHandle.vue',
  'components/DynamicForm.vue', 'components/DynamicSelectField.vue', 'components/DynamicRelationField.vue',
  'components/DynamicTableField.vue', 'components/DynamicUserField.vue', 'components/DynamicFileField.vue',
  'components/DynamicFileValue.vue', 'components/DynamicTable.vue', 'components/FieldDateValue.vue',
  'components/FieldFormModal.vue', 'components/FieldImpactWarningModal.vue', 'components/FieldValidationParameter.vue',
  'components/ReportOptionSelect.vue', 'components/RecordAssociationsPanel.vue', 'components/RecordDetailView.vue',
  'components/RecordLinesTable.vue', 'components/RecordKanbanBoard.vue', 'components/RecordCalendar.vue',
  'components/ActivityTimeline.vue', 'components/VariableTextField.vue',
  'pages/registros/[entity]/index.vue', 'pages/registros/[entity]/[id]/index.vue',
  'pages/registros/[entity]/nuevo.vue', 'pages/registros/[entity]/[id]/editar.vue',
  'pages/ajustes/index.vue', 'pages/mi-cuenta.vue', 'pages/organizacion.vue',
  'pages/usuarios/index.vue', 'pages/usuarios/[id].vue', 'pages/roles/index.vue',
  'pages/platform/plans.vue', 'pages/registros/[entity]/importar.vue',
  'components/SettingsProfile.vue', 'components/SettingsSessions.vue', 'components/SettingsApiKeys.vue',
  'components/SettingsBillingSummary.vue', 'components/SettingsEmailAccordion.vue',
  'components/SettingsFiscalModuleMapping.vue', 'components/SettingsNotificationGroups.vue',
  'components/AgentUsageTable.vue', 'components/IconPicker.vue', 'components/ModuleTourHelpButton.vue',
  'pages/modulos/index.vue', 'pages/modulos/nuevo.vue', 'pages/modulos/[id]/editar.vue', 'pages/catalogos/index.vue', 'pages/catalogos/nuevo.vue', 'pages/chat/index.vue',
  'components/ModuleListing.vue', 'components/ModuleWizard.vue', 'components/ModuleFieldsCard.vue',
  'components/ModulePreviewCard.vue', 'components/ModuleDetailLayoutCard.vue', 'components/ModuleListLayoutCard.vue',
  'components/ModuleListPreviewCard.vue', 'components/ModuleStateWorkflowCard.vue', 'components/ModuleRelationsCard.vue',
  'components/ModuleNavigationEditor.vue', 'components/ModuleApiDocs.vue', 'components/ModuleLabelEditor.vue', 'components/WorkflowNotificationRecipients.vue',
  'components/ChatAvatar.vue', 'components/ChatConversationList.vue', 'components/ChatThread.vue',
  'components/ChatFloatingDock.vue', 'components/ChatGifPicker.vue', 'components/ChatGroupEditModal.vue', 'components/ChatNewConversationModal.vue',
  'pages/disenador.vue', 'components/designer/DesignerCanvas.client.vue', 'components/MarkdownView.vue',
  'utils/designerChattito.ts', 'utils/designerWarnings.ts', 'utils/designerChat.ts', 'utils/designerClient.ts',
  'utils/designerMarkdown.ts', 'components/ChattitoMessageAvatar.vue', 'components/ChattitoAvatar.vue',
  // HU-167: interfaz Sites; el editor y documentos públicos permanecen claros.
  'pages/sites/[siteId]/analytics/index.vue',
  'pages/sites/[siteId]/domains/index.vue',
  'pages/sites/[siteId]/forms/index.vue',
  'pages/sites/[siteId]/index.vue',
  'pages/sites/[siteId]/landing-pages/index.vue',
  'pages/sites/[siteId]/overview/index.vue',
  'pages/sites/[siteId]/pages/index.vue',
  'pages/sites/[siteId]/publications/index.vue',
  'pages/sites/[siteId]/settings/index.vue',
  'pages/sites/analytics/index.vue',
  'pages/sites/domains/index.vue',
  'pages/sites/forms/index.vue',
  'pages/sites/index.vue',
  'pages/sites/landing-pages/index.vue',
  'pages/sites/pages/index.vue',
  'pages/sites/templates.vue',
  'pages/sites/trash.vue',
  'components/SitesAnalyticsSummary.vue',
  'components/SitesDomainManager.vue',
  'components/SitesFormManager.vue',
  'components/SitesPageManager.vue',
  // HU-168: editor; preview y miniaturas aislados localmente en claro.
  'pages/sites/[siteId]/pages/[pageId].vue',
  'components/SitesCodeEditor.client.vue', 'components/SitesEditorForms.vue',
  'components/SitesAssetLibrary.vue', 'utils/sitesCodeTheme.ts',
  // HU-170: cromo de Automatización/reportes. Page solo representa papel claro.
  // Sheet/Preview conservan sus fuentes completas por contrato SHA de theme170,
  // con excepciones cerradas por literal y cantidad para el documento claro.
  'pages/triggers/index.vue', 'pages/triggers/[id]/editar.vue', 'pages/reportes/nuevo.vue',
  'pages/registros/[entity]/reportes/nuevo.vue', 'pages/registros/[entity]/reportes/[id]/editar.vue',
  'components/WorkflowActionNode.vue', 'components/WorkflowConditionRows.vue',
  'components/WorkflowFieldValue.vue', 'components/WorkflowUpsertRecordConfig.vue',
  'components/PrintReportPage.vue', 'components/PrintReportDesigner.vue',
  'components/PrintReportFieldPicker.vue', 'components/PrintReportFieldTree.vue',
  'components/PrintReportFilterSelect.vue', 'components/PrintReportLayoutControls.vue',
  'components/PrintReportDataControls.vue', 'components/PrintReportParameterModal.vue',
  'components/PrintReportSheet.vue', 'components/PrintReportPreview.vue',
  // HU-171: interfaz CFDI y elegir plan. La representación impresa queda clara.
  'pages/facturacion/index.vue', 'pages/facturacion/nuevo.vue',
  'pages/facturacion/[id].vue', 'pages/elegir-plan.vue', 'utils/cfdiCatalogos.ts',
  'pages/facturacion-print/[id].vue'
] as const

/** Sombras heredadas de HU-161: alfa decorativo, sin rol de texto/superficie.
 * Se permite únicamente cada literal y cantidad indicados; añadir otro falla.
 * ChattitoArtwork y public/brand son ilustraciones de marca, fuera de esta lista.
 * Los colores configurados por el usuario llegan como datos, no literales del SFC.
 */
export const themeColorExceptions: Record<string, Record<string, number>> = {
  // HU-171: factura impresa intacta. Cada literal y cantidad quedan cerrados.
  'pages/facturacion-print/[id].vue': {
    '#f5f8fa': 1,
    '#33475b': 13,
    '#cbd6e2': 2,
    '#fff': 6,
    '#ff7a59': 3,
    '#33475b20': 1,
    '#f1dfb4': 1,
    '#fef0d2': 1,
    '#b3720a': 1,
    '#eaf3f6': 3,
    '#0091ae': 3,
    '#516f90': 11,
    '#ccf1de': 1,
    '#0a7a4f': 1,
    '#eaf0f6': 3,
    '#fbe0dd': 2,
    '#c7391f': 2,
    '#e5f5f8': 1,
    '#e5eaf0': 4,
    '#fafbfc': 2,
    '#f7f9fa': 1,
    '#8da1b5': 4,
  },
  'app.vue': { '#33475b1f': 1 },
  'layouts/default.vue': { '#33475B22': 1, '#33475B12': 1 },
  'components/AppNavGroup.vue': { '#33475B26': 1 },
  'components/AppNavTooltip.vue': { '#33475B20': 1, '#33475b33': 1 },
  'components/ChattitoHelp.vue': { '#33475b14': 1 },
  'components/FlowAppLauncher.vue': { 'rgba(33,61,94,.17)': 1 },
  'components/NotificationCenter.vue': { '#33475B22': 1 },
  'components/SidebarPlanUsage.vue': { '#33475b26': 1 },
  'components/DynamicTable.vue': { '#33475B14': 1 },
  'components/RecordDetailView.vue': { '#33475B22': 1 },
  // HU-170: papel/salida imprimible siempre claros, incluidos sus avisos
  // y marco de previsualización protegido. Una aparición adicional falla.
  'components/PrintReportSheet.vue': {
    '#2B2B2B': 2, '#fff': 1, '#23334220': 1, '#9A9A9A': 1,
    '#1A1A1A': 4, '#666666': 3, '#8A8A8A': 3, '#3A3A3A': 1,
    '#DCDCDC': 2, '#EAEAEA': 1, '#B8B8B8': 1, '#E4E4E4': 1,
    '#1F1F1F': 2, '#CFCFCF': 3, '#EDEDED': 1, '#FFFFFF': 1,
    '#FAFAFA': 1, '#F2F2F2': 1, '#B0B0B0': 1, '#9b351d': 1,
    '#fff0e8': 1, 'background: white': 1
  },
  'components/PrintReportPreview.vue': {
    '#e7ebee': 1, '#fff': 4, '#d5dde3': 1, '#213343': 2,
    '#516f90': 3, '#cbd6e2': 2, '#33475b': 1, '#f0f4f6': 1,
    '#0091ae': 2, '#FF7A59': 2, '#E66E50': 2, '#8DA1B5': 2,
    '#EAF3F6': 1, 'background: white': 1
  }
}

export function auditThemeSource(file: string, source: string): string[] {
  // Los comentarios documentales no generan CSS ni atributos.
  const code = source.replace(/<!--[^]*?-->|\/\*[^]*?\*\//g, match => match.replace(/[^\n]/g, ' '))
  const pattern = /\b(?:bg|text|border|ring|fill|stroke|outline|divide|from|via|to|placeholder|accent|decoration|shadow)-(?:white|black|(?:gray|slate|zinc|neutral|stone|red|green|blue|yellow|orange|purple|pink|indigo|amber|emerald|teal|cyan|sky|violet|fuchsia|rose|lime)-\d{2,3})\b|#[\da-fA-F]{3,8}(?![\w-])|rgba?\(\s*\d[^)]*\)|\b(?:background(?:-color)?|color|fill|stroke):\s*(?:white|black)\b/g
  const counts: Record<string, number> = {}
  const errors: string[] = []
  for (const match of code.matchAll(pattern)) {
    const literal = match[0]
    counts[literal] = (counts[literal] ?? 0) + 1
    if (counts[literal] > (themeColorExceptions[file]?.[literal] ?? 0)) {
      const line = code.slice(0, match.index).split('\n').length
      errors.push(`${file}:${line}: color fijo no autorizado: ${literal}`)
    }
  }
  return errors
}

export function auditThemeColors() {
  return migratedThemeFiles.flatMap(file => auditThemeSource(file, readFileSync(file, 'utf8')))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const errors = auditThemeColors()
  errors.forEach(error => console.error(error))
  console.log(`${migratedThemeFiles.length} archivos auditados; ${errors.length} infracciones.`)
  process.exitCode = errors.length ? 1 : 0
}
