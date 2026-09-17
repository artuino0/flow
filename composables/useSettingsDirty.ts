export function useSettingsDirty() {
  const dirty = useState<boolean>('settings-dirty', () => false)
  const saveHandler = useState<(() => void | Promise<void>) | null>('settings-save-handler', () => null)
  const discardHandler = useState<(() => void) | null>('settings-discard-handler', () => null)
  function setDirty(value: boolean) { dirty.value = value }
  function setSaveHandler(handler: (() => void | Promise<void>) | null) { saveHandler.value = handler }
  function setDiscardHandler(handler: (() => void) | null) { discardHandler.value = handler }
  return { dirty, setDirty, saveHandler, discardHandler, setSaveHandler, setDiscardHandler }
}
