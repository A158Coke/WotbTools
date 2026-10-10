import type { InjectionKey } from 'vue'
import type { ReplayCapability } from '../types/workspace.js'

export type OnboardingTopic = 'core' | 'data' | 'playback' | 'annotations' | '3d' | 'shots' | 'ai' | 'tankopedia' | 'hof' | 'tournament' | 'settings'

/** The real workspace retains ownership of files, analysis and capability navigation. */
export interface OnboardingWorkspace {
  hasFiles(): boolean
  busy(): boolean
  selectionIdentity(): unknown
  loadDemo(signal?: AbortSignal): Promise<void>
  setCapability(capability: ReplayCapability): Promise<void> | void
  chooseOwnReplay(): Promise<void> | void
}

/** Commands remain owned by the active real pane; the guide only requests them. */
export interface OnboardingSurface {
  ready(): boolean
  failed?(): boolean
  prepare?(): Promise<void> | void
  cleanup?(): void
  /** Reserve viewport space for the guide without covering a real inspector. */
  setGuideInset?(pixels: number): void
}

export type OnboardingSurfaceId = 'playback' | 'annotations' | '3d' | 'shots' | 'armor'

export interface OnboardingContext {
  start(topic?: OnboardingTopic): void
  openDirectory(): void
  sampleOpened(): void
  registerWorkspace(workspace: OnboardingWorkspace | null): void
  registerSurface(id: OnboardingSurfaceId, surface: OnboardingSurface | null): void
}

export const ONBOARDING_KEY: InjectionKey<OnboardingContext> = Symbol('wotbtools.onboarding')
