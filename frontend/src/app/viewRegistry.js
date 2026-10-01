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
const AgentReplay3DPage = defineAsyncComponent(() => import('../components/AgentReplay3D.vue'))
const AgentTankopediaPage = defineAsyncComponent(() => import('../components/AgentTankopedia.vue'))
const AgentArmorViewPage = defineAsyncComponent(() => import('../components/AgentArmorView.vue'))
const AgentShotsPage = defineAsyncComponent(() => import('../components/AgentShots.vue'))
const RatingDocsPage = defineAsyncComponent(() => import('../components/RatingDocsPage.vue'))

export const VIEW_COMPONENTS = Object.freeze({
  home: HomePage,
  replay: ReplayWorkspace,
  'ai-review': ReplayWorkspace,
  'battle-playback': ReplayWorkspace,
  'agent-replay': AgentReplay3DPage,
  'agent-tankopedia': AgentTankopediaPage,
  'agent-armor': AgentArmorViewPage,
  'agent-shots': AgentShotsPage,
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
  return 'data'
}
