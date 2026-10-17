import type { InjectionKey, Ref } from 'vue'
import type { CreatorCategory } from '../api/creators.js'

export interface CreatorAvailability {
  available: Readonly<Ref<boolean>>
  loading: Readonly<Ref<boolean>>
  error: Readonly<Ref<unknown>>
  contentKnown: Readonly<Ref<boolean>>
  publicCategories: Readonly<Ref<readonly CreatorCategory[]>>
  directoryVisible: Readonly<Ref<boolean>>
  refresh: () => Promise<void>
  refreshPublicCategories: () => Promise<void>
}
export const CREATOR_AVAILABILITY_KEY: InjectionKey<CreatorAvailability> = Symbol('creator-availability')
