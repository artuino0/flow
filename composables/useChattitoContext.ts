import { recommendedTourForContext, resolveChattitoContext } from '~/utils/chattitoContext'

export function useChattitoContext() {
  const route = useRoute()
  const { data: isAdmin } = useIsAdmin()
  const context = computed(() => resolveChattitoContext(route, isAdmin.value === true))
  const recommendedTour = computed(() => recommendedTourForContext(context.value))
  return { context, recommendedTour }
}
