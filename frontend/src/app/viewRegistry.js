import { computed, defineAsyncComponent, defineComponent, h, ref } from 'vue'
import { readMotionTokens } from '../shared/motion/motionPolicy'
import HomePage from '../components/HomePage.vue'
import ReplayWorkspace from '../components/ReplayWorkspace.vue'
import ViewTransitionLoading from '../components/ViewTransitionLoading.vue'
import ViewTransitionError from '../components/ViewTransitionError.vue'
import { toReplayCapability } from '../types/workspace.js'

// 审计 PF-02：只有落地页（首页 / 回放工作台）同步加载，其余页面按需拆包，
// 管理页、markdown-it、DOMPurify、历史 .md 不再进主包。

// View 切换的统一加载/错误契约（#845）：异步 chunk 加载超过 `--duration-slow`
//（300ms，reduced-motion / 无 DOM 时回落同值常量——token 在该档被清零，而
// flicker 阈值是 UX 判定不是动画时长）才显示统一 loading，快速切换不闪 spinner；
// 加载失败进入统一错误面，重试重建内部 async component（attempt++ 全新加载）。
// latest-wins 由 Vue 卸载语义保证：切换后 pending loader 的结果不会再被渲染，
// loading 状态绑定的是当前这次视图转换。
//
// 为什么重试在 wrapper 而不是 defineAsyncComponent 的 onError retry：提供 onError
// 即接管错误处理——同步 fail() 会让内部 promise 立即 settle，此后 userRetry 是
// no-op（实测 Vue 3.5 runtime-core）；「先 fail 再 retry」在单个 async component
// 内做不到，必须由外层状态机重建（attempt++ + 重建内部组件）。
export const VIEW_LOAD_DELAY_MS = 300

/** 异步视图工厂：loading / error / retry 面在 ViewHost 的 <main> 内呈现，单一 owner。 */
export function asyncView(loader) {
  return defineComponent({
    name: 'AsyncView',
    setup() {
      const attempt = ref(0)
      const failed = ref(false)
      const retry = () => {
        failed.value = false
        attempt.value++
      }
      const inner = computed(() => {
        attempt.value   // 依赖收集：attempt 变化 → 重建全新 async component
        return defineAsyncComponent({
          loader: () => loader(attempt.value),
          loadingComponent: ViewTransitionLoading,
          delay: (() => {
            const slow = readMotionTokens().slow
            return slow > 0 ? Math.round(slow * 1000) : VIEW_LOAD_DELAY_MS
          })(),
          onError(error) {
            // onError 接管后内层停留在 pending（不调 fail/retry，P 保持未决即可）：
            // 失败呈现交给 wrapper 的 failed 状态；悬空的 loader promise 随内层
            // 卸载被丢弃（load 链带 isUnmounted 守卫）。
            failed.value = true
            console.error('[viewHost] 异步视图 chunk 加载失败:', error)
          },
        })
      })
      return () => {
        if (failed.value) return h(ViewTransitionError, { onRetry: retry })
        return h(inner.value)
      }
    },
  })
}
const HoFPage = asyncView(() => import('../components/HoFPage.vue'))
const HoFAdminPage = asyncView(() => import('../components/HoFAdminPage.vue'))
const ProfilePage = asyncView(() => import('../components/ProfilePage.vue'))
const BattleDataAdminPage = asyncView(() => import('../components/BattleDataAdminPage.vue'))
const AdminUsersPage = asyncView(() => import('../components/AdminUsersPage.vue'))
const AdminAiReviewFeedbackPage = asyncView(() => import('../components/AdminAiReviewFeedbackPage.vue'))
const AdminSiteFeedbackPage = asyncView(() => import('../components/AdminSiteFeedbackPage.vue'))
const HistoryPage = asyncView(() => import('../components/HistoryPage.vue'))
const TechnicalEvolutionPage = asyncView(() => import('../components/TechnicalEvolutionPage.vue'))
const ContactPage = asyncView(() => import('../components/ContactPage.vue'))
const AndroidDownloadPage = asyncView(() => import('../components/AndroidDownloadPage.vue'))
const SponsorPage = asyncView(() => import('../components/SponsorPage.vue'))
const MorePage = asyncView(() => import('../components/MorePage.vue'))
const AgentTankopediaPage = asyncView(() => import('../components/AgentTankopedia.vue'))
const AgentArmorViewPage = asyncView(() => import('../components/AgentArmorView.vue'))
const AgentTechTreePage = asyncView(() => import('../components/AgentTechTree.vue'))
const MapPreviewPage = asyncView(() => import('../components/MapPreviewPage.vue'))
const RatingDocsPage = asyncView(() => import('../components/RatingDocsPage.vue'))
const TournamentPointsPage = asyncView(() => import('../components/TournamentPointsPage.vue'))
const TournamentPointsConfigPage = asyncView(() => import('../components/TournamentPointsConfigPage.vue'))
const TournamentPointsAdminPage = asyncView(() => import('../components/TournamentPointsAdminPage.vue'))
const LeagueBroadcastsPage = asyncView(() => import('../components/LeagueBroadcastsPage.vue'))
const RecommendationsPage = asyncView(() => import('../components/RecommendationsPage.vue'))
const CreatorsPage = asyncView(() => import('../components/CreatorsPage.vue'))
const CreatorsConfigPage = asyncView(() => import('../components/CreatorsConfigPage.vue'))

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
  recommendations: RecommendationsPage,
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
