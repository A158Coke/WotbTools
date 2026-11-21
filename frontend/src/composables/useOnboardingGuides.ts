/** 新手引导内容注册表（拆分自 useOnboarding.ts，行为原样）：
 *  短核心教程与可选功能教程共用同一步骤/阶段模型。 */
import type { OnboardingSurfaceId, OnboardingTopic } from '../shared/onboarding.js'
import type { ReplayCapability } from '../types/workspace.js'

export interface GuideStage {
  anchor: string
  copy: string
  /** Some tools act on a second real surface, such as drawing on the map. */
  interactionAnchor?: string
  surface?: OnboardingSurfaceId
  /** Advance after a real owner reports readiness, without synthesizing a click. */
  advanceOnReady?: boolean
  prepare?: boolean
}
export interface GuideStep {
  id: string
  capability?: ReplayCapability
  view?: string
  stages: GuideStage[]
}
// prepare 之前必须先等 ready 的 surface：它们的 ready() 表示"回放视图已挂上、可以被准备"。
// 'annotations' 不在此列——它的 ready() 表示目标状态已达成（工具条已打开），只能在 prepare 之后成立。
export const SURFACES_READY_BEFORE_PREPARE = new Set<OnboardingSurfaceId>(['playback', 'display', '3d'])

const stage = (anchor: string, copy: string, extra: Partial<GuideStage> = {}): GuideStage => ({ anchor, copy, ...extra })
const step = (id: string, capability: ReplayCapability, stages: GuideStage[]): GuideStep => ({ id, capability, stages })
const demo = step('demo', 'data', [stage('workspace-demo', 'demo')])
const data = step('data', 'data', [stage('data-toolbar', 'data')])
const playback = step('playback', 'playback', [stage('playback-transport', 'playback', { surface: 'playback', prepare: true, interactionAnchor: 'playback-floating-fullscreen' })])
const annotations = step('annotations', 'playback', [
  stage('playback-annotation-entry', 'annotationEntry', { surface: 'annotations', advanceOnReady: true }),
  stage('playback-annotation-tools', 'annotationTools', { surface: 'annotations', interactionAnchor: 'playback-map' }),
])
// 防遮控件住在 Display 面里：prepare 打开那块面，interactionAnchor 把整块面纳入交互 / 焦点范围
// （面打开时焦点落在它的关闭按钮上，第一次 Escape 必须交给面自己关，而不是被教程吞掉）。
const declutter = step('declutter', 'playback', [stage('playback-declutter', 'declutter', { surface: 'display', prepare: true, interactionAnchor: 'playback-display-options' })])
const replay3d = step('3d', '3d', [
  stage('replay3d-start', 'replay3dStart', { surface: '3d', advanceOnReady: true }),
  stage('replay3d-camera', 'replay3dCamera', { surface: '3d', prepare: true, interactionAnchor: 'replay3d-workspace' }),
])
const shots = step('shots', 'shots', [
  stage('shots-first-shot', 'shots', { surface: 'shots', prepare: true, advanceOnReady: true }),
  stage('shot-open-viewer', 'shotViewer', { surface: 'armor', advanceOnReady: true, interactionAnchor: 'shots-inspector' }),
  stage('armor-workspace', 'armor', { surface: 'armor' }),
])

/** One registry is shared by the short core guide and the optional function guides. */
export const ONBOARDING_GUIDES: Record<OnboardingTopic, GuideStep[]> = {
  core: [demo, data, playback, annotations, declutter, replay3d, shots],
  data: [demo, data, step('columns', 'data', [stage('data-columns', 'columns', { interactionAnchor: 'data-column-options' })]), step('export', 'data', [stage('data-export', 'export')])],
  playback: [playback, step('timeline', 'playback', [stage('playback-timeline', 'timeline')]), step('display', 'playback', [stage('playback-display', 'display', { interactionAnchor: 'playback-display-options' })])],
  annotations: [annotations, step('drawing', 'playback', [stage('playback-annotation-tools', 'drawing', { surface: 'annotations', prepare: true, interactionAnchor: 'playback-map' })]), declutter],
  '3d': [replay3d, step('camera', '3d', [stage('replay3d-camera', 'camera', { surface: '3d', prepare: true, interactionAnchor: 'replay3d-workspace' })]), step('3dDisplay', '3d', [stage('playback-display', 'display', { interactionAnchor: 'playback-display-options' })])],
  shots: [step('shotList', 'shots', [stage('shots-first-shot', 'shots', { surface: 'shots', prepare: true, advanceOnReady: true })]),
    step('shotOpen', 'shots', [stage('shot-open-viewer', 'shotViewer', { surface: 'armor', advanceOnReady: true, interactionAnchor: 'shots-inspector' })]),
    { id: 'armor', stages: [stage('armor-workspace', 'armor', { surface: 'armor' })] }],
  ai: [step('aiFiles', 'ai', [stage('workspace-file-controls', 'aiFiles')]), step('aiStart', 'ai', [stage('ai-review-start', 'aiStart')]), step('aiReport', 'ai', [stage('ai-review-report', 'aiReport')])],
  tankopedia: [
    { id: 'tankFilters', view: 'agent-tankopedia', stages: [stage('tankopedia-search', 'tankFilters', { interactionAnchor: 'tankopedia-filters' })] },
    { id: 'tankDetail', view: 'agent-tankopedia', stages: [stage('tankopedia-list', 'tankDetail')] },
    { id: 'tankArmor', view: 'agent-tankopedia', stages: [stage('tankopedia-armor', 'tankArmor')] },
  ],
  hof: [
    { id: 'hofBoards', view: 'hof', stages: [stage('hof-tabs', 'hofBoards')] },
    { id: 'hofFilters', view: 'hof', stages: [stage('hof-filters', 'hofFilters', { interactionAnchor: 'hof-filter-options' })] },
    { id: 'hofRecords', view: 'hof', stages: [stage('hof-records', 'hofRecords')] },
    { id: 'hofSubmit', view: 'hof', stages: [stage('hof-submit', 'hofSubmit')] },
  ],
  tournament: [
    { id: 'tournamentEvent', view: 'tournament-points', stages: [stage('tournament-event', 'tournamentEvent')] },
    { id: 'tournamentStandings', view: 'tournament-points', stages: [stage('tournament-standings', 'tournamentStandings')] },
    { id: 'tournamentExport', view: 'tournament-points', stages: [stage('tournament-export', 'tournamentExport')] },
  ],
  settings: [
    { id: 'settingsTheme', view: 'more', stages: [stage('settings-theme', 'settingsTheme')] },
    { id: 'settingsLanguage', view: 'more', stages: [stage('settings-language', 'settingsLanguage')] },
    { id: 'settingsAccount', view: 'profile', stages: [stage('settings-account', 'settingsAccount')] },
  ],
}
export const ONBOARDING_TOPICS = Object.keys(ONBOARDING_GUIDES).filter(id => id !== 'core') as Exclude<OnboardingTopic, 'core'>[]
