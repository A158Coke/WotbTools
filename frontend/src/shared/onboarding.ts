import type { ComputedRef, InjectionKey } from 'vue'
import type { ReplayCapability } from '../types/workspace.js'

export type OnboardingTopic = 'core' | 'data' | 'playback' | 'annotations' | '3d' | 'shots' | 'ai' | 'tankopedia' | 'hof' | 'tournament' | 'settings'

export interface OnboardingWorkspace {
  hasFiles(): boolean
  busy(): boolean
  selectionIdentity(): unknown
  loadDemo(signal?: AbortSignal): Promise<void>
  setCapability(capability: ReplayCapability): Promise<void> | void
  chooseOwnReplay(): Promise<void> | void
}

export interface OnboardingSurface {
  ready(): boolean
  failed?(): boolean
  prepare?(): Promise<void> | void
  cleanup?(): void
  setGuideInset?(pixels: number): void
}

export type OnboardingSurfaceId = 'playback' | 'annotations' | 'display' | '3d' | 'shots' | 'armor'

export interface OnboardingContext {
  guideActive: ComputedRef<boolean>
  start(topic?: OnboardingTopic): void
  openDirectory(): void
  sampleOpened(): void
  registerWorkspace(workspace: OnboardingWorkspace | null): void
  registerSurface(id: OnboardingSurfaceId, surface: OnboardingSurface | null): void
}

export const ONBOARDING_KEY: InjectionKey<OnboardingContext> = Symbol('wotbtools.onboarding')

export const REPLACE_DECLINED = 'ReplaceDeclinedError'
