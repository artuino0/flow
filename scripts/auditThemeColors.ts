import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

/** Lista cerrada: cascarón HU-161, registros HU-162, ajustes HU-163 y módulos/chat HU-164. */
export const migratedThemeFiles = [
  'app.vue', 'assets/css/main.css', 'layouts/default.vue', 'pages/index.vue',
  'components/AppNav.vue', 'components/AppNavEntity.vue', 'components/AppNavGroup.vue', 'components/AppNavTooltip.vue',
  'components/ChattitoHelp.vue', 'components/ChattitoPanel.vue', 'components/ChattitoToggle.vue',
  'components/FlowAppLauncher.vue', 'components/GlobalSearch.vue', 'components/NotificationCenter.vue',
  'components/InactivityWarningModal.vue', 'components/SettingsConfirmDialog.vue', 'components/SidebarPlanUsage.vue',
  'components/ThemeSelector.vue', 'components/ToastContainer.vue', 'components/ListPageHeader.vue',
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
  'utils/designerMarkdown.ts', 'components/ChattitoMessageAvatar.vue', 'components/ChattitoAvatar.vue'
] as const

/** Sombras heredadas de HU-161: alfa decorativo, sin rol de texto/superficie.
 * Se permite únicamente cada literal y cantidad indicados; añadir otro falla.
 * ChattitoArtwork y public/brand son ilustraciones de marca, fuera de esta lista.
 * Los colores configurados por el usuario llegan como datos, no literales del SFC.
 */
export const themeColorExceptions: Record<string, Record<string, number>> = {
  'app.vue': { '#33475b1f': 1 },
  'layouts/default.vue': { '#33475B22': 1, '#33475B12': 1 },
  'components/AppNavGroup.vue': { '#33475B26': 1 },
  'components/AppNavTooltip.vue': { '#33475B20': 1, '#33475b33': 1 },
  'components/ChattitoHelp.vue': { '#33475b14': 1 },
  'components/FlowAppLauncher.vue': { 'rgba(33,61,94,.17)': 1 },
  'components/NotificationCenter.vue': { '#33475B22': 1 },
  'components/SidebarPlanUsage.vue': { '#33475b26': 1 },
  'components/DynamicTable.vue': { '#33475B14': 1 },
  'components/RecordDetailView.vue': { '#33475B22': 1 }
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
