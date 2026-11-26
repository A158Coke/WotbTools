import { FeatureRequirement, getFeatureAvailability } from '../app/featureCapabilities.js'
import { useConnectivity } from './useConnectivity.js'
import { showConnectivityNotice } from './useConnectivityNotice.js'

export function useFeatureGate() {
  const { connectivity, settled, whenSettled } = useConnectivity()

  function availability(feature: string) {
    const result = getFeatureAvailability(feature, { connectivity: connectivity.value })
    const dependsOnConnectivity = result.requirement !== null && result.requirement !== FeatureRequirement.LOCAL
    return Object.freeze({ ...result, pending: dependsOnConnectivity && !settled.value })
  }

  function isAvailable(feature: string) {
    return availability(feature).available
  }

  function requireFeature(feature: string) {
    const current = availability(feature)
    if (!current.pending) return evaluateFeatureGate(feature, connectivity.value)
    if (current.available) return true
    void whenSettled().then(() => evaluateFeatureGate(feature, connectivity.value))
    return false
  }

  return {
    availability,
    isAvailable,
    requireFeature,
    connectivity,
  }
}

export function evaluateFeatureGate(feature: string, connectivity: unknown, notify = showConnectivityNotice) {
  const result = getFeatureAvailability(feature, { connectivity })
  if (!result.available && result.messageKey) notify(result)
  return result.available
}
