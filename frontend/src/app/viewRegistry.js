import { defineAsyncComponent } from 'vue'
import HomePage from '../components/HomePage.vue'
import ReplayWorkspace from '../components/ReplayWorkspace.vue'
import HoFPage from '../components/HoFPage.vue'
import HoFAdminPage from '../components/HoFAdminPage.vue'
import ProfilePage from '../components/ProfilePage.vue'
import AdminUsersPage from '../components/AdminUsersPage.vue'
import HistoryPage from '../components/HistoryPage.vue'
import ContactPage from '../components/ContactPage.vue'
import AndroidDownloadPage from '../components/AndroidDownloadPage.vue'

const PlaybackQaPage = defineAsyncComponent(() => import('../components/PlaybackQaPage.vue'))
const RatingDocsPage = defineAsyncComponent(() => import('../components/RatingDocsPage.vue'))
const RatingV2AdminPage = defineAsyncComponent(() => import('../components/RatingV2AdminPage.vue'))

export const VIEW_COMPONENTS = Object.freeze({
  home: HomePage,
  replay: ReplayWorkspace,
  'ai-review': ReplayWorkspace,
  'battle-playback': ReplayWorkspace,
  hof: HoFPage,
  'hof-admin': HoFAdminPage,
  profile: ProfilePage,
  'admin-users': AdminUsersPage,
  history: HistoryPage,
  contact: ContactPage,
  android: AndroidDownloadPage,
  'playback-qa': PlaybackQaPage,
  'rating-docs': RatingDocsPage,
  'rating-v2': RatingV2AdminPage,
})

export function replayInitialCapability(view) {
  if (view === 'ai-review') return 'ai'
  if (view === 'battle-playback') return 'playback'
  return 'data'
}
