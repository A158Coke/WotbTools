import { defineAsyncComponent } from 'vue'
import HomePage from '../components/HomePage.vue'
import ReplayWorkspace from '../components/ReplayWorkspace.vue'

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

// 3D 回放 / 射击分析是工作台能力（与 2D / AI 同一条 session、同一个 pane 壳），不再有独立页面：
// 深链 ?view=agent-replay / ?view=agent-shots 解析为带对应 capability 的 ReplayWorkspace。
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

export function replayInitialCapability(view) {
  if (view === 'ai-review') return 'ai'
  if (view === 'battle-playback') return 'playback'
  if (view === 'agent-replay') return '3d'
  if (view === 'agent-shots') return 'shots'
  return 'data'
}
