export type ModuleListingTab = 'table' | 'board' | 'calendar'

export function nextModuleListingTab(current: ModuleListingTab, key: string): ModuleListingTab | null {
  const tabs: ModuleListingTab[] = ['table', 'board', 'calendar']
  const currentIndex = tabs.indexOf(current)

  if (key === 'ArrowRight') return tabs[(currentIndex + 1) % tabs.length] ?? null
  if (key === 'ArrowLeft') return tabs[(currentIndex + tabs.length - 1) % tabs.length] ?? null
  if (key === 'Home') return tabs[0] ?? null
  if (key === 'End') return tabs[tabs.length - 1] ?? null
  return null
}
