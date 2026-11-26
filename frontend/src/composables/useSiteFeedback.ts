import { ref } from 'vue'
import type { RouteLocationNormalizedLoaded } from 'vue-router'
import { Feature } from '../app/featureCapabilities.js'
import { viewFromRoute } from '../app/navigation.js'
import { useAuth } from './useAuth.js'
import { useFeatureGate } from './useFeatureGate.js'

export function useSiteFeedback(route: RouteLocationNormalizedLoaded) {
  const { requireFeature } = useFeatureGate()
  const { authenticated, login } = useAuth()
  const open = ref(false)
  const pageView = ref<string | null>(null)

  function request() {
    if (!requireFeature(Feature.SITE_FEEDBACK)) return
    if (!authenticated.value) {
      void login({ path: route.path, query: route.query, hash: route.hash })
      return
    }
    pageView.value = viewFromRoute(route)
    open.value = true
  }

  return { open, pageView, request }
}
