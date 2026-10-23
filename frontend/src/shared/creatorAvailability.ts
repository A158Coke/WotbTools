import type { InjectionKey, Ref } from 'vue'
import type { RecommendationCategory, RecommendationType } from '../api/creators.js'

export interface CreatorAvailability {
  available: Readonly<Ref<boolean>>
  typeAvailable: (type: RecommendationType) => boolean
  typeVisible: (type: RecommendationType) => boolean
  loading: Readonly<Ref<boolean>>
  error: Readonly<Ref<unknown>>
  contentKnown: Readonly<Ref<boolean>>
  publicCategories: Readonly<Ref<readonly RecommendationCategory[]>>
  directoryVisible: Readonly<Ref<boolean>>
  refresh: () => Promise<void>
  refreshPublicCategories: () => Promise<void>
}
export const CREATOR_AVAILABILITY_KEY: InjectionKey<CreatorAvailability> = Symbol('creator-availability')
