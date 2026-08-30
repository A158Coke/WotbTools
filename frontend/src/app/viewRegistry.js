import { defineAsyncComponent } from 'vue'
import HomePage from '../components/HomePage.vue'
import ReplayWorkspace from '../components/ReplayWorkspace.vue'
import HoFPage from '../components/HoFPage.vue'
import HoFAdminPage from '../components/HoFAdminPage.vue'
import ProfilePage from '../components/ProfilePage.vue'
import BoostPage from '../components/BoostPage.vue'
import AdminUsersPage from '../components/AdminUsersPage.vue'
import VersionPage from '../components/VersionPage.vue'
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
  boost: BoostPage,
  'admin-users': AdminUsersPage,
  version: VersionPage,
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
