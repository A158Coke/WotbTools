import { defineAsyncComponent } from 'vue'
import HomePage from '../components/HomePage.vue'
import ReplayWorkspace from '../components/ReplayWorkspace.vue'
import { toReplayCapability } from '../types/workspace.js'
import ViewLoadingState from './ViewLoadingState.vue'
import ViewLoadError from './ViewLoadError.vue'

export const VIEW_LOAD_FEEDBACK_DELAY_MS = 300

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
const AgentVersionDiffPage = defineLazyView(() => import('../components/AgentVersionDiff.vue'))
const MapPreviewPage = defineLazyView(() => import('../components/MapPreviewPage.vue'))
const RatingDocsPage = defineLazyView(() => import('../components/RatingDocsPage.vue'))
const TournamentPointsPage = defineLazyView(() => import('../components/TournamentPointsPage.vue'))
const TournamentPointsConfigPage = defineLazyView(() => import('../components/TournamentPointsConfigPage.vue'))
const TournamentPointsAdminPage = defineLazyView(() => import('../components/TournamentPointsAdminPage.vue'))
const LeagueBroadcastsPage = defineLazyView(() => import('../components/LeagueBroadcastsPage.vue'))
const CreatorsPage = defineLazyView(() => import('../components/CreatorsPage.vue'))
const CreatorsConfigPage = defineLazyView(() => import('../components/CreatorsConfigPage.vue'))

export const VIEW_COMPONENTS = Object.freeze({
  home: HomePage,
  replay: ReplayWorkspace,
  'ai-review': ReplayWorkspace,
  'battle-playback': ReplayWorkspace,
  'agent-replay': ReplayWorkspace,
  'agent-events': ReplayWorkspace,
  'agent-shots': ReplayWorkspace,
  'agent-tankopedia': AgentTankopediaPage,
  'agent-mobility': defineLazyView(() => import('../components/AgentMobility.vue')),
  'agent-armor': AgentArmorViewPage,
  'agent-techtree': AgentTechTreePage,
  'agent-version-diff': AgentVersionDiffPage,
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

const CAPABILITY_BY_VIEW = Object.freeze({
  replay: 'data',
  'agent-replay': '3d',
  'agent-events': 'events',
  'agent-shots': 'shots',
  'battle-playback': 'playback',
  'ai-review': 'ai',
})

export function replayInitialCapability(view) {
  return toReplayCapability(CAPABILITY_BY_VIEW[view])
}
