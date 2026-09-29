import type { Driver } from 'driver.js'
import { driver } from 'driver.js'
import { h, render } from 'vue'
import ChattitoAvatar from '~/components/ChattitoAvatar.vue'
import { lookAtElement } from '~/utils/chattito'
import { allowsTourTargetClick, canRunTour, canStartOnboarding, canStartTourRequest, clearTourProgress, destroyTourDriver, MANUAL_TOUR_BACK_EVENT, manualResumeIndex, manualTourBackStage, manualWizardStorageKey, nextTourIndex, onboardingSessionIdentity, onboardingTours, permittedTourSteps, previousTourIndex, readManualWizardDraft, readTourCompletion, readTourProgress, showDesignerAccess, TOUR_POPOVER_CONTROLS, TOUR_SELECTORS, TOUR_TARGET_FAILURE_MESSAGE, tourAdvance, tourChoiceDestination, tourDismissalKey, tourProgressKey, tourStepDestination, tourStorageKey, waitForTourTarget, writeTourCompletion, writeTourProgress, type OnboardingStep, type TourBranch, type TourId, type TourProgress } from '~/utils/onboardingTours'

let activeDriver: Driver | undefined
let avatarHost: HTMLElement | undefined
let highlightedClickCleanup: (() => void) | undefined
let keyboardCleanup: (() => void) | undefined
let completionCleanup: (() => void) | undefined
let expectedNavigation = false
let tourGeneration = 0
let stepRequest = 0
let tourOriginPath = '/'

function unmountAvatar() {
  if (avatarHost) render(null, avatarHost)
  avatarHost = undefined
}

function isElementVisible(element: Element) {
  const style = getComputedStyle(element)
  return element.getClientRects().length > 0 && style.display !== 'none' && style.visibility !== 'hidden'
}

function pathMatches(path: string | undefined, currentPath: string) {
  if (!path) return true
  return path === '/' ? currentPath === '/' : currentPath === path || currentPath.startsWith(`${path}/`)
}

function createTourButton(label: string, className: string, onClick: () => void, disabled = false) {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = className
  button.textContent = label
  button.disabled = disabled
  button.addEventListener('click', onClick)
  return button
}

function keepPopoverBesidePanel(popover: HTMLElement) {
  const panel = document.querySelector('.chattito-panel-slot--open')
  if (!panel) return
  const panelRect = panel.getBoundingClientRect()
  const popoverRect = popover.getBoundingClientRect()
  if (panelRect.left > 0 && popoverRect.right > panelRect.left - 12) {
    popover.style.left = `${Math.max(12, panelRect.left - popoverRect.width - 12)}px`
  }
  if (panelRect.top > 0 && popoverRect.bottom > panelRect.top - 12) {
    popover.style.top = `${Math.max(12, panelRect.top - popoverRect.height - 12)}px`
  }
}

export function useOnboarding() {
  const { user } = useAuth()
  const adminRequest = useIsAdmin()
  const { data: isAdmin, status: adminStatus } = adminRequest
  const planRequest = useDesignerPlanUsage(isAdmin)
  const { data: planUsage, status: planStatus } = planRequest
  const route = useRoute()
  const { panel: chattitoPanel, addMessage } = useChattitoPanel()
  const toast = useToast()
  const activeId = useState<TourId | null>('onboarding-active-id', () => null)
  const attemptedIdentity = useState<string | null>('onboarding-attempted-identity', () => null)
  const completedInMemory = useState<string[]>('onboarding-completed-memory', () => [])
  const progressInMemory = useState<Record<string, TourProgress>>('onboarding-progress-memory', () => ({}))
  const progressRevision = useState<number>('onboarding-progress-revision', () => 0)
  const activeBranch = useState<TourBranch>('onboarding-active-branch', () => null)
  const sessionIdentity = computed(() => onboardingSessionIdentity(user.value))
  const tourAccess = computed(() => ({ isAdmin: adminStatus.value === 'success' && isAdmin.value === true, designerAvailable: planStatus.value === 'success' && showDesignerAccess(planUsage.value?.code) }))
  const canLaunchTour = (id: TourId) => canRunTour(onboardingTours[id], tourAccess.value)
  const activeSteps = ref<readonly OnboardingStep[]>([])
  const activeIndex = useState<number>('onboarding-active-index', () => 0)

  function storageKey(id: TourId) {
    const current = user.value
    return current?.authenticated ? tourStorageKey(current.tenantId, current.id, id) : null
  }
  function progressKey(id: TourId) {
    const current = user.value
    return current?.authenticated ? tourProgressKey(current.tenantId, current.id, id) : null
  }
  function getProgress(id: TourId): TourProgress | null {
    const key = progressKey(id)
    if (!key) return null
    if (progressInMemory.value[key]) return progressInMemory.value[key]
    return import.meta.client ? readTourProgress(localStorage, key, id) : null
  }
  function saveProgress(id: TourId, index: number) {
    const key = progressKey(id)
    if (!key) return
    const progress: TourProgress = { id, index, branch: activeBranch.value, originPath: tourOriginPath }
    progressInMemory.value = { ...progressInMemory.value, [key]: progress }
    progressRevision.value++
    if (import.meta.client) writeTourProgress(localStorage, key, progress)
  }
  function discardProgress(id: TourId) {
    const key = progressKey(id)
    if (!key) return
    const next = { ...progressInMemory.value }
    delete next[key]
    progressInMemory.value = next
    progressRevision.value++
    if (import.meta.client) clearTourProgress(localStorage, key)
    if (import.meta.client && id === 'crear-modulo-manual' && user.value?.authenticated) {
      try { localStorage.removeItem(manualWizardStorageKey(user.value.tenantId, user.value.id)) } catch { /* El estado en memoria se descarta igualmente. */ }
    }
  }
  const pendingTour = computed(() => {
    progressRevision.value
    for (const id of ['crear-modulo-manual', 'primer-modulo', 'bienvenida'] as const) {
      if (!canLaunchTour(id)) continue
      const progress = getProgress(id)
      if (progress) return progress
    }
    return null
  })
  function isCompleted(id: TourId) {
    const key = storageKey(id)
    if (!key) return false
    if (completedInMemory.value.includes(key)) return true
    if (!import.meta.client) return false
    return readTourCompletion(localStorage, key)
  }
  function markCompleted(id: TourId) {
    const key = storageKey(id)
    if (!key) return
    if (!completedInMemory.value.includes(key)) completedInMemory.value = [...completedInMemory.value, key]
    // La persistencia por usuario vive en el navegador por ahora; después puede pasar a la base de datos.
    if (import.meta.client) writeTourCompletion(localStorage, key)
  }
  function isDismissed(id: TourId) {
    const current = user.value
    if (!current?.authenticated) return false
    const key = tourDismissalKey(current.tenantId, current.id, id)
    if (completedInMemory.value.includes(key)) return true
    return import.meta.client ? readTourCompletion(localStorage, key) : false
  }
  function markDismissed(id: TourId) {
    const current = user.value
    if (!current?.authenticated) return
    const key = tourDismissalKey(current.tenantId, current.id, id)
    if (!completedInMemory.value.includes(key)) completedInMemory.value = [...completedInMemory.value, key]
    if (import.meta.client) writeTourCompletion(localStorage, key)
  }
  function stopTour() {
    tourGeneration++
    stepRequest++
    highlightedClickCleanup?.()
    highlightedClickCleanup = undefined
    keyboardCleanup?.()
    keyboardCleanup = undefined
    completionCleanup?.()
    completionCleanup = undefined
    destroyTourDriver(activeDriver)
    activeDriver = undefined
    expectedNavigation = false
    unmountAvatar()
    activeId.value = null
    activeSteps.value = []
    activeIndex.value = 0
    activeBranch.value = null
  }
  function omitTour() {
    const id = activeId.value ?? pendingTour.value?.id
    if (id) { discardProgress(id); markDismissed(id) }
    stopTour()
  }
  function finishTour(id: TourId) {
    discardProgress(id)
    markCompleted(id)
    stopTour()
  }
  function pauseTour(message = 'Pausamos aquí. Cuando quieras, retoma el recorrido conmigo.') {
    const id = activeId.value
    if (!id) return
    stopTour()
    addMessage({ role: 'assistant', text: message, emotion: 'happy', action: { kind: 'resume-tour', tourId: id } })
  }
  function finishWithMessage(_id: TourId, message: string) {
    pauseTour(message)
    toast.error('Recorrido detenido', message)
  }
  function reset() {
    stopTour()
    attemptedIdentity.value = null
    completedInMemory.value = []
  }

  async function showStep(index: number, navigateIfNeeded = false): Promise<boolean> {
    const id = activeId.value
    const step = activeSteps.value[index]
    const identity = sessionIdentity.value
    const generation = tourGeneration
    const request = ++stepRequest
    const isCurrent = () => request === stepRequest && generation === tourGeneration && identity === sessionIdentity.value && id === activeId.value
    if (!id || !identity) return false
    if (!step) {
      finishTour(id)
      return false
    }
    activeIndex.value = index
    saveProgress(id, index)

    const backToAccount = navigateIfNeeded && id === 'primer-modulo' && index < 2
    const destination = navigateIfNeeded ? tourStepDestination(id, index, step, tourOriginPath) : step.path
    if (destination && !pathMatches(destination, route.path) && navigateIfNeeded) {
      expectedNavigation = true
      try {
        await navigateTo(destination)
        await nextTick()
      } catch {
        if (isCurrent()) finishWithMessage(id, TOUR_TARGET_FAILURE_MESSAGE)
        return false
      }
    }
    if (!isCurrent()) return false

    if (backToAccount) {
      highlightedClickCleanup?.()
      highlightedClickCleanup = undefined
      const account = await waitForTourTarget(
        () => document.querySelector(TOUR_SELECTORS.account),
        isElementVisible,
        { timeoutMs: 8_000, intervalMs: 50 }
      ) as HTMLElement | null
      if (!isCurrent()) return false
      if (!account) {
        finishWithMessage(id, TOUR_TARGET_FAILURE_MESSAGE)
        return false
      }
      const shouldOpen = index === 1
      const menuIsOpen = Boolean(document.querySelector(TOUR_SELECTORS.accountMenu))
      if (menuIsOpen !== shouldOpen) {
        account.click()
        await nextTick()
      }
    }

    const target = await waitForTourTarget(
      () => pathMatches(destination && navigateIfNeeded ? destination : step.path, route.path) ? step.selector ? document.querySelector(step.selector) : document.body : null,
      element => step.selector ? isElementVisible(element) : true,
      { timeoutMs: step.optional ? 250 : 8_000, intervalMs: 50 }
    )
    if (!isCurrent()) return false
    if (!target) {
      if (step.optional) return showStep(index + 1)
      finishWithMessage(id, TOUR_TARGET_FAILURE_MESSAGE)
      return false
    }
    const element = step.selector ? target : undefined
    expectedNavigation = false
    highlightedClickCleanup?.()
    highlightedClickCleanup = undefined
    keyboardCleanup?.()
    keyboardCleanup = undefined
    completionCleanup?.()
    completionCleanup = undefined
    destroyTourDriver(activeDriver)
    unmountAvatar()

    let instance: Driver
    const advance = tourAdvance(step, index, activeSteps.value.length)
    const moveForward = () => { void showStep(nextTourIndex(id, index, activeBranch.value), false) }
    const clickTarget = () => {
      highlightedClickCleanup?.()
      highlightedClickCleanup = undefined
      const nextStep = activeSteps.value[nextTourIndex(id, index, activeBranch.value)]
      expectedNavigation = Boolean(nextStep?.path && nextStep.path !== step.path)
      moveForward()
    }

    if (allowsTourTargetClick(step) && element) {
      element.addEventListener('click', clickTarget)
      highlightedClickCleanup = () => element.removeEventListener('click', clickTarget)
    }

    instance = driver({
      animate: !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      allowKeyboardControl: false,
      allowClose: true,
      allowScroll: true,
      disableActiveInteraction: !allowsTourTargetClick(step),
      overlayClickBehavior: () => {},
      overlayColor: '#213343',
      overlayOpacity: 0.42,
      stagePadding: 8,
      stageRadius: 10,
      popoverClass: 'flow-tour',
      showProgress: TOUR_POPOVER_CONTROLS.showProgress,
      showButtons: [...TOUR_POPOVER_CONTROLS.showButtons],
      steps: [{
        element,
        disableActiveInteraction: !allowsTourTargetClick(step),
        popover: { title: step.title, description: step.text, side: step.side, showButtons: [...TOUR_POPOVER_CONTROLS.showButtons], showProgress: TOUR_POPOVER_CONTROLS.showProgress },
      }],
      onPopoverRender: (popover) => {
        unmountAvatar()
        const heading = document.createElement('div')
        heading.className = 'flow-tour__heading'
        avatarHost = document.createElement('div')
        avatarHost.className = 'flow-tour__avatar'
        const titleParent = popover.title.parentElement
        titleParent?.insertBefore(heading, popover.title)
        heading.append(avatarHost, popover.title)
        if (chattitoPanel.value.open) {
          const stillAvatar = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
          stillAvatar.setAttribute('viewBox', '0 0 200 200')
          stillAvatar.setAttribute('aria-hidden', 'true')
          stillAvatar.classList.add('flow-tour__still-avatar')
          stillAvatar.innerHTML = '<use href="#chattito-symbol"></use>'
          avatarHost.append(stillAvatar)
        } else {
          render(h(ChattitoAvatar, { state: step.emotion, size: 'sm', lookAt: element ? lookAtElement(element) : 'center' }), avatarHost)
        }

        const controls = popover.footerButtons
        controls.replaceChildren()
        controls.classList.add('flow-tour__controls')
        const backUnavailable = index === 0 || (id === 'crear-modulo-manual' && (index === 3 || index === 4))
        const backButton = createTourButton('Atrás', 'flow-tour__back', () => {
          if (backUnavailable) return
          if (id === 'crear-modulo-manual') {
            const stage = manualTourBackStage(index)
            if (stage) window.dispatchEvent(new CustomEvent(MANUAL_TOUR_BACK_EVENT, { detail: stage }))
          }
          void showStep(previousTourIndex(id, index, activeBranch.value), true)
        }, backUnavailable)
        if (id === 'crear-modulo-manual' && backUnavailable && index > 0) backButton.title = 'El módulo ya se creó; puedes continuar u omitir el recorrido.'
        controls.append(backButton)
        if (advance.kind === 'choice') {
          controls.append(createTourButton('Verlo manualmente', 'flow-tour__action', () => {
            void startTour(tourChoiceDestination('manual').tourId).then(started => {
              if (started) discardProgress(id)
            })
          }))
          controls.append(createTourButton('Que me ayude el Diseñador', 'flow-tour__action', () => {
            activeBranch.value = 'designer'
            saveProgress(id, index)
            void showStep(tourChoiceDestination('designer').index, false)
          }))
        } else if (advance.kind === 'offer-designer') {
          controls.append(createTourButton('Ir al Diseñador', 'flow-tour__action', () => {
            if (!canLaunchTour('primer-modulo')) {
              finishTour(id)
              toast.error('Diseñador no disponible', 'Tu módulo quedó creado. Podrás abrir el Diseñador cuando tengas acceso.')
              return
            }
            expectedNavigation = true
            void (async () => {
              try {
                await navigateTo('/disenador')
                await nextTick()
                if (!isCurrent()) return
                finishTour(id)
                discardProgress('primer-modulo')
                activeId.value = 'primer-modulo'
                activeSteps.value = permittedTourSteps(onboardingTours['primer-modulo'], tourAccess.value)
                activeBranch.value = 'designer'
                tourOriginPath = '/modulos'
                const designerIndex = activeSteps.value.findIndex(item => item.selector === TOUR_SELECTORS.designer)
                void showStep(designerIndex, false)
              } catch {
                if (isCurrent()) finishWithMessage(id, TOUR_TARGET_FAILURE_MESSAGE)
              }
            })()
          }))
          controls.append(createTourButton('Terminar', 'flow-tour__finish', () => finishTour(id)))
        } else if (advance.kind === 'navigate') {
          controls.append(createTourButton(advance.label, 'flow-tour__action', () => {
            expectedNavigation = true
            void (async () => {
              try {
                await navigateTo(advance.path)
                await nextTick()
                if (isCurrent()) moveForward()
              } catch {
                if (isCurrent()) finishWithMessage(id, TOUR_TARGET_FAILURE_MESSAGE)
              }
            })()
          }))
          controls.append(createTourButton('Terminar', 'flow-tour__finish', () => finishTour(id)))
        } else if (advance.kind === 'next' || advance.kind === 'finish') {
          controls.append(createTourButton(advance.label, 'flow-tour__next', () => {
            if (advance.kind === 'finish') finishTour(id)
            else moveForward()
          }))
        }
        controls.append(createTourButton('Omitir', 'flow-tour__skip', omitTour))
        popover.closeButton.setAttribute('aria-label', 'Pausar recorrido')
        popover.closeButton.setAttribute('title', 'Pausar')
        popover.progress.textContent = `Paso ${index + 1} de ${activeSteps.value.length}`
      },
      onHighlighted: () => {
        requestAnimationFrame(() => {
          if (activeDriver === instance) {
            const popover = document.querySelector('.driver-popover.flow-tour') as HTMLElement | null
            if (popover) keepPopoverBesidePanel(popover)
          }
        })
      },
      onCloseClick: () => pauseTour(),
      onDestroyStarted: () => {
        pauseTour()
      },
      onDestroyed: () => {
        if (activeDriver === instance) activeDriver = undefined
        unmountAvatar()
      },
    })
    activeDriver = instance
    let immediateCompletionCheck: (() => void) | undefined
    if (step.completeWhen) {
      const completion = step.completeWhen
      if ('selector' in completion) {
        const checkCompletion = () => {
          const next = document.querySelector(completion.selector)
          if (isCurrent() && next && isElementVisible(next)) moveForward()
        }
        const observer = new MutationObserver(checkCompletion)
        observer.observe(document.body, { childList: true, subtree: true })
        completionCleanup = () => observer.disconnect()
        immediateCompletionCheck = checkCompletion
      } else {
        const stopWatching = watch(() => route.path, path => {
          if (isCurrent() && path === completion.path) {
            expectedNavigation = true
            moveForward()
          }
        }, { flush: 'sync' })
        completionCleanup = stopWatching
      }
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); pauseTour(); return }
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return
      if (event.key === 'ArrowLeft' && index > 0 && !(id === 'crear-modulo-manual' && (index === 3 || index === 4))) {
        event.preventDefault()
        if (id === 'crear-modulo-manual') {
          const stage = manualTourBackStage(index)
          if (stage) window.dispatchEvent(new CustomEvent(MANUAL_TOUR_BACK_EVENT, { detail: stage }))
        }
        void showStep(previousTourIndex(id, index, activeBranch.value), true)
        return
      }
      if (event.key === 'ArrowRight' && (advance.kind === 'next' || advance.kind === 'finish')) {
        event.preventDefault()
        if (advance.kind === 'finish') finishTour(id)
        else moveForward()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    keyboardCleanup = () => window.removeEventListener('keydown', onKeyDown)
    instance.drive()
    queueMicrotask(() => { if (isCurrent()) immediateCompletionCheck?.() })
    return true
  }

  async function startTour(id: TourId) {
    if (!import.meta.client || !sessionIdentity.value || !canStartOnboarding(user.value, route.path, route.meta.layout, import.meta.dev)) return false
    const identity = sessionIdentity.value
    if (adminStatus.value === 'pending') await adminRequest
    if (id !== 'bienvenida' && isAdmin.value === true && (planStatus.value !== 'success' || !planUsage.value)) {
      try { await planRequest.refresh() } catch { if (id === 'primer-modulo') return false }
    }
    if (identity !== sessionIdentity.value || !canStartOnboarding(user.value, route.path, route.meta.layout, import.meta.dev)) return false
    if (!canStartTourRequest(id, user.value, route.path, route.meta.layout, tourAccess.value, import.meta.dev)) return false
    attemptedIdentity.value = identity
    stopTour()
    discardProgress(id)
    activeId.value = id
    activeSteps.value = permittedTourSteps(onboardingTours[id], tourAccess.value)
    activeBranch.value = null
    tourOriginPath = route.path === '/dev/chattito' ? '/' : route.path
    if (route.path === '/dev/chattito') {
      expectedNavigation = true
      try {
        await navigateTo('/')
        await nextTick()
      } catch {
        finishWithMessage(id, TOUR_TARGET_FAILURE_MESSAGE)
        return false
      }
    }
    if (identity !== sessionIdentity.value || !canStartOnboarding(user.value, route.path, route.meta.layout)) {
      stopTour()
      return false
    }
    return showStep(0, id === 'crear-modulo-manual')
  }

  async function resumeTour(requestedId?: TourId) {
    const progress = requestedId ? getProgress(requestedId) : pendingTour.value
    if (!progress || !import.meta.client || !sessionIdentity.value) return false
    if (progress.id === 'primer-modulo' && progress.branch === 'manual' && progress.index >= 3) {
      const started = await startTour('crear-modulo-manual')
      if (started) discardProgress('primer-modulo')
      return started
    }
    const identity = sessionIdentity.value
    if (adminStatus.value === 'pending') await adminRequest
    if (progress.id !== 'bienvenida' && isAdmin.value === true && (planStatus.value !== 'success' || !planUsage.value)) {
      try { await planRequest.refresh() } catch { if (progress.id === 'primer-modulo') return false }
    }
    if (identity !== sessionIdentity.value || !canStartTourRequest(progress.id, user.value, route.path, route.meta.layout, tourAccess.value, import.meta.dev)) return false
    stopTour()
    activeId.value = progress.id
    activeSteps.value = permittedTourSteps(onboardingTours[progress.id], tourAccess.value)
    activeBranch.value = progress.branch
    tourOriginPath = progress.originPath
    attemptedIdentity.value = identity
    const draftKey = progress.id === 'crear-modulo-manual' && user.value?.authenticated
      ? manualWizardStorageKey(user.value.tenantId, user.value.id) : null
    const draft = draftKey ? readManualWizardDraft(localStorage, draftKey) : null
    return showStep(progress.id === 'crear-modulo-manual' ? manualResumeIndex(progress.index, draft) : progress.index, true)
  }

  async function startWelcomeOnce() {
    if (!import.meta.client || !sessionIdentity.value || !canStartOnboarding(user.value, route.path, route.meta.layout)) return false
    const identity = sessionIdentity.value
    if (adminStatus.value === 'pending') await adminRequest
    if (identity !== sessionIdentity.value || !canStartOnboarding(user.value, route.path, route.meta.layout)) return false
    if (!canLaunchTour('bienvenida')) return false
    if (attemptedIdentity.value === sessionIdentity.value || isCompleted('bienvenida') || isDismissed('bienvenida') || getProgress('bienvenida')) return false
    attemptedIdentity.value = sessionIdentity.value
    activeId.value = 'bienvenida'
    activeSteps.value = permittedTourSteps(onboardingTours.bienvenida, tourAccess.value)
    return showStep(0)
  }

  function handleRouteChange() {
    if (!activeId.value || expectedNavigation) return
    const step = activeSteps.value[activeIndex.value]
    if (step?.completeWhen && 'path' in step.completeWhen && route.path === step.completeWhen.path) return
    pauseTour('¡Va! Veo que ya andas explorando por tu cuenta. Guardé tu lugar; aquí está el botón para retomarlo cuando quieras.')
  }

  return { activeId, activeIndex, pendingTour, sessionIdentity, canLaunchTour, isCompleted, markCompleted, startTour, resumeTour, startWelcomeOnce, stopTour, omitTour, reset, handleRouteChange }
}
