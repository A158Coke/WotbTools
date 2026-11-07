import { defineAsyncComponent } from 'vue'
import HomePage from '../components/HomePage.vue'
import ReplayWorkspace from '../components/ReplayWorkspace.vue'
import { toReplayCapability } from '../types/workspace.js'
import ViewLoadingState from './ViewLoadingState.vue'
import ViewLoadError from './ViewLoadError.vue'

// 审计 PF-02：只有落地页（首页 / 回放工作台）同步加载，其余页面按需拆包，
// 管理页、markdown-it、DOMPurify、历史 .md 不再进主包。
//
// 统一的 View transition 边界（#845）：慢加载在 main 内容区显示 loading surface，
// chunk 失败显示可恢复的 error surface。delay 是「异步延迟反馈阈值」，不是动画时长，
// 不能绑定 --duration-*（prefers-reduced-motion 会把它归零，反而立即闪 loader）。
export const VIEW_LOAD_FEEDBACK_DELAY_MS = 300

/**
 * 全部 lazy View 的唯一创建入口：loading / error presentation 只在这里配置一次。
 * latest-wins、timer 清理与「卸载后丢弃结果」由 Vue async component 语义保证：
 * 每个 wrapper 实例持有自己的 loaded/error/delayed，resolve/reject 先检查
 * `instance.isUnmounted`，delay timer 在 onUnmounted 清除（runtime-core 3.5 实测）。
 */
export const defineLazyView = loader => defineAsyncComponent({
  loader,
  delay: VIEW_LOAD_FEEDBACK_DELAY_MS,
  loadingComponent: ViewLoadingState,
  errorComponent: ViewLoadError,
})

const HoFPage = defineLazyView(() => import('../components/HoFPage.vue'))
const HoFAdminPage = defineLazyView(() => import('../components/HoFAdminPage.vue'))
const ProfilePage = defineLazyView(() => import('../components/ProfilePage.vue'))
const BattleDataAdminPage = defineLazyView(() => import('../components/BattleDataAdminPage.vue'))
const AdminUsersPage = defineLazyView(() => import('../components/AdminUsersPage.vue'))
const AdminAiReviewFeedbackPage = defineLazyView(() => import('../components/AdminAiReviewFeedbackPage.vue'))
const AdminSiteFeedbackPage = defineLazyView(() => import('../components/AdminSiteFeedbackPage.vue'))
const HistoryPage = defineLazyView(() => import('../components/HistoryPage.vue'))
const TechnicalEvolutionPage = defineLazyView(() => import('../components/TechnicalEvolutionPage.vue'))
const ContactPage = defineLazyView(() => import('../components/ContactPage.vue'))
const AndroidDownloadPage = defineLazyView(() => import('../components/AndroidDownloadPage.vue'))
const SponsorPage = defineLazyView(() => import('../components/SponsorPage.vue'))
const MorePage = defineLazyView(() => import('../components/MorePage.vue'))
const AgentTankopediaPage = defineLazyView(() => import('../components/AgentTankopedia.vue'))
const AgentArmorViewPage = defineLazyView(() => import('../components/AgentArmorView.vue'))
const AgentTechTreePage = defineLazyView(() => import('../components/AgentTechTree.vue'))
const MapPreviewPage = defineLazyView(() => import('../components/MapPreviewPage.vue'))
const RatingDocsPage = defineLazyView(() => import('../components/RatingDocsPage.vue'))
const TournamentPointsPage = defineLazyView(() => import('../components/TournamentPointsPage.vue'))
const TournamentPointsConfigPage = defineLazyView(() => import('../components/TournamentPointsConfigPage.vue'))
const TournamentPointsAdminPage = defineLazyView(() => import('../components/TournamentPointsAdminPage.vue'))
const LeagueBroadcastsPage = defineLazyView(() => import('../components/LeagueBroadcastsPage.vue'))
const CreatorsPage = defineLazyView(() => import('../components/CreatorsPage.vue'))
const CreatorsConfigPage = defineLazyView(() => import('../components/CreatorsConfigPage.vue'))

/**
 * 回放工作台是唯一 capability orchestrator：`replay` / `battle-playback` / `ai-review`
 * 与旧深链 `agent-replay` / `agent-shots` 全部落在同一个 `ReplayWorkspace`，由
 * `replayInitialCapability` 决定初始能力。五种能力均公开可见；3D / 射击 / AI 登录后使用。
 * 管理员角色不改变工作台能力。3D 与射击不再有独立页面，
 * 深链只是工作台的能力入口。
 *
 * 坦克百科 → 装甲查看器（`agent-armor`）仍是独立页面：装甲查看器属于坦克百科，
 * 不属于回放工作台（design-language §9 的 Master–Detail 只在工作台内部成立）。
 */
export const VIEW_COMPONENTS = Object.freeze({
  home: HomePage,
  replay: ReplayWorkspace,
  'ai-review': ReplayWorkspace,
  'battle-playback': ReplayWorkspace,
  'agent-replay': ReplayWorkspace,
  'agent-shots': ReplayWorkspace,
  'agent-tankopedia': AgentTankopediaPage,
  'agent-armor': AgentArmorViewPage,
  'agent-techtree': AgentTechTreePage,
  'map-preview': MapPreviewPage,
  hof: HoFPage,
  more: MorePage,
  'hof-admin': HoFAdminPage,
  profile: ProfilePage,
  'admin-users': AdminUsersPage,
  'admin-battle-data': BattleDataAdminPage,
  'admin-ai-review-feedback': AdminAiReviewFeedbackPage,
  'admin-site-feedback': AdminSiteFeedbackPage,
  history: HistoryPage,
  'technical-evolution': TechnicalEvolutionPage,
  contact: ContactPage,
  android: AndroidDownloadPage,
  sponsor: SponsorPage,
  'rating-docs': RatingDocsPage,
  'tournament-points': TournamentPointsPage,
  'tournament-points-config': TournamentPointsConfigPage,
  'tournament-points-admin': TournamentPointsAdminPage,
  'league-broadcasts': LeagueBroadcastsPage,
  recommendations: CreatorsPage,
  'recommended-videos': CreatorsPage,
  creators: CreatorsPage,
  'creators-config': CreatorsConfigPage,
})

/** view → 工作台初始能力（唯一映射点）。 */
const CAPABILITY_BY_VIEW = Object.freeze({
  replay: 'data',
  'agent-replay': '3d',
  'agent-shots': 'shots',
  'battle-playback': 'playback',
  'ai-review': 'ai',
})

export function replayInitialCapability(view) {
  return toReplayCapability(CAPABILITY_BY_VIEW[view])
}
