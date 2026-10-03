import { defineAsyncComponent } from 'vue'
import HomePage from '../components/HomePage.vue'
import ReplayWorkspace from '../components/ReplayWorkspace.vue'
import { toReplayCapability } from '../types/workspace.js'

// 审计 PF-02：只有落地页（首页 / 回放工作台）同步加载，其余页面按需拆包，
// 管理页、markdown-it、DOMPurify、历史 .md 不再进主包。
const HoFPage = defineAsyncComponent(() => import('../components/HoFPage.vue'))
const HoFAdminPage = defineAsyncComponent(() => import('../components/HoFAdminPage.vue'))
const ProfilePage = defineAsyncComponent(() => import('../components/ProfilePage.vue'))
const AdminUsersPage = defineAsyncComponent(() => import('../components/AdminUsersPage.vue'))
const HistoryPage = defineAsyncComponent(() => import('../components/HistoryPage.vue'))
const TechnicalEvolutionPage = defineAsyncComponent(() => import('../components/TechnicalEvolutionPage.vue'))
const ContactPage = defineAsyncComponent(() => import('../components/ContactPage.vue'))
const AndroidDownloadPage = defineAsyncComponent(() => import('../components/AndroidDownloadPage.vue'))
const SponsorPage = defineAsyncComponent(() => import('../components/SponsorPage.vue'))
const MorePage = defineAsyncComponent(() => import('../components/MorePage.vue'))
const AgentTankopediaPage = defineAsyncComponent(() => import('../components/AgentTankopedia.vue'))
const AgentArmorViewPage = defineAsyncComponent(() => import('../components/AgentArmorView.vue'))
const RatingDocsPage = defineAsyncComponent(() => import('../components/RatingDocsPage.vue'))

/**
 * 回放工作台是唯一 capability orchestrator：`replay` / `battle-playback` / `ai-review`
 * 与旧深链 `agent-replay` / `agent-shots` 全部落在同一个 `ReplayWorkspace`，由
 * `replayInitialCapability` 决定初始能力（3D / 射击仍受 admin feature flag 约束，
 * 见 `app/navigation.js` 的 `ADMIN_ONLY_VIEWS`）。3D 与射击不再有独立页面，
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
  hof: HoFPage,
  more: MorePage,
  'hof-admin': HoFAdminPage,
  profile: ProfilePage,
  'admin-users': AdminUsersPage,
  history: HistoryPage,
  'technical-evolution': TechnicalEvolutionPage,
  contact: ContactPage,
  android: AndroidDownloadPage,
  sponsor: SponsorPage,
  'rating-docs': RatingDocsPage,
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
