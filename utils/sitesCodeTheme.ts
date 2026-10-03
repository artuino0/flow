import { EditorView } from '@codemirror/view'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'

const color = (name: string) => `rgb(var(--brand-${name}))`

// El tema claro conserva todas las reglas y defaults anteriores a HU-168.
export const sitesCodeBaseTheme = EditorView.theme({
  '&': { height: '100%', maxHeight: '100%', backgroundColor: color('sites-editor-code-bg'), color: color('text'), fontSize: '13px' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace', lineHeight: '1.65', overflow: 'auto' },
  '.cm-content': { padding: '14px 0', caretColor: color('blue') },
  '.cm-line': { padding: '0 18px 0 8px' },
  '.cm-gutters': { backgroundColor: color('sites-editor-gutter'), color: color('sites-muted'), borderRight: `1px solid ${color('border-light')}`, paddingLeft: '6px' },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: color('sites-editor-active') },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor: `${color('sites-editor-selection')} !important` },
  '.cm-cursor': { borderLeftColor: color('blue') },
  '.cm-searchMatch': { backgroundColor: color('sites-editor-search'), outline: `1px solid ${color('sites-editor-search-border')}` },
  '.cm-tooltip': { border: `1px solid ${color('control-border')}`, borderRadius: '6px', overflow: 'hidden' }
})

export const sitesCodeDarkRules = {
  '&': { backgroundColor: color('bg'), color: color('text'), colorScheme: 'dark' },
  '&.cm-focused': { outline: `2px solid ${color('blue')}`, outlineOffset: '-2px' },
  '.cm-gutters': { color: color('sites-muted') },
  '.cm-selectionBackground': { outline: `1px solid ${color('blue')}` },
  '.cm-activeLineGutter': { boxShadow: `inset 2px 0 ${color('blue')}` },
  '.cm-selectionMatch': { backgroundColor: color('sites-editor-search') },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: color('sites-editor-search'), outline: `2px solid ${color('sites-editor-search-border')}` },
  '.cm-matchingBracket': { backgroundColor: color('bg'), outline: `1px solid ${color('sites-editor-match-bracket')}` },
  '.cm-nonmatchingBracket': { backgroundColor: color('bg'), outline: `1px solid ${color('sites-editor-bad-bracket')}` },
  '.cm-tooltip, .cm-tooltip-autocomplete': { backgroundColor: color('sites-editor-tooltip'), color: color('text'), borderColor: color('control-border') },
  '.cm-tooltip-section:not(:first-child), .cm-tooltip-autocomplete ul completion-section': { borderColor: color('control-border'), opacity: '1' },
  '.cm-tooltip-autocomplete ul li[aria-selected]': { backgroundColor: color('sites-editor-completion'), color: color('sites-editor-completion-text') },
  '.cm-tooltip-autocomplete-disabled ul li[aria-selected]': { backgroundColor: color('sites-editor-completion-disabled'), color: color('sites-editor-completion-text') },
  '.cm-completionDetail, .cm-completionIcon': { color: color('text-secondary'), opacity: '1' },
  '.cm-completionMatchedText': { color: color('blue') },
  '.cm-tooltip-arrow:before': { borderTopColor: color('control-border'), borderBottomColor: color('control-border') },
  '.cm-tooltip-arrow:after': { borderTopColor: color('sites-editor-tooltip'), borderBottomColor: color('sites-editor-tooltip') },
  '.cm-panels': { backgroundColor: color('sites-editor-search-panel'), color: color('text') },
  '.cm-panels-top, .cm-panels-bottom': { borderColor: color('control-border') },
  '.cm-textfield, .cm-button': { backgroundImage: 'none', backgroundColor: color('surface'), color: color('text'), border: `1px solid ${color('control-border')}` },
  '.cm-button:hover, .cm-button:active': { backgroundImage: 'none', backgroundColor: color('sites-action-hover') },
  '.cm-textfield:focus-visible, .cm-button:focus-visible, .cm-panel input:focus-visible': { outline: `2px solid ${color('blue')}`, outlineOffset: '1px' },
  '.cm-panel input': { accentColor: color('blue'), colorScheme: 'dark' },
  '.cm-foldPlaceholder': { backgroundColor: color('surface'), color: color('text-secondary'), borderColor: color('control-border') },
  '.cm-diagnostic': { backgroundColor: color('surface'), color: color('text') },
  '.cm-diagnostic-error': { borderLeftColor: color('error-text') },
  '.cm-lintRange-error': { textDecoration: `underline wavy ${color('error-text')}`, backgroundImage: 'none' },
  '.cm-lintPoint:after': { borderBottomColor: color('error-text') }
}

// Un HighlightStyle explícito impide que el fallback claro pinte sintaxis oscura.
export const sitesCodeDarkHighlight = HighlightStyle.define([
  { tag: tags.meta, color: color('sites-editor-syntax-meta') },
  { tag: tags.keyword, color: color('sites-editor-syntax-keyword') },
  { tag: [tags.atom, tags.bool, tags.url, tags.contentSeparator, tags.labelName], color: color('sites-editor-syntax-atom') },
  { tag: [tags.literal, tags.inserted, tags.tagName], color: color('sites-editor-syntax-literal') },
  { tag: [tags.string, tags.deleted], color: color('sites-editor-syntax-string') },
  { tag: [tags.regexp, tags.escape, tags.special(tags.string)], color: color('sites-editor-syntax-regexp') },
  { tag: tags.definition(tags.variableName), color: color('sites-editor-syntax-definition') },
  { tag: tags.local(tags.variableName), color: color('sites-editor-syntax-local') },
  { tag: [tags.typeName, tags.namespace], color: color('sites-editor-syntax-type') },
  { tag: tags.className, color: color('sites-editor-syntax-class') },
  { tag: [tags.special(tags.variableName), tags.macroName], color: color('sites-editor-syntax-special') },
  { tag: [tags.definition(tags.propertyName), tags.attributeName], color: color('sites-editor-syntax-property') },
  { tag: tags.comment, color: color('sites-editor-syntax-comment') },
  { tag: tags.invalid, color: color('sites-editor-syntax-invalid') }
])

export const sitesCodeDarkTheme = [EditorView.theme(sitesCodeDarkRules, { dark: true }), syntaxHighlighting(sitesCodeDarkHighlight)]
