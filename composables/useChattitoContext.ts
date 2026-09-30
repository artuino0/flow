import { recommendedTourForContext, resolveChattitoContext } from '~/utils/chattitoContext'

export function useChattitoContext() {
  const route = useRoute()
  const context = computed(() => resolveChattitoContext(route))
  const recommendedTour = computed(() => recommendedTourForContext(context.value))
  return { context, recommendedTour }
}
