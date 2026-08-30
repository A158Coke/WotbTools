import { createRouter, createWebHistory } from 'vue-router'
import AppShell from './AppShell.vue'
import ViewHost from './ViewHost.vue'
import { canonicalView, LEGACY_VIEW_ALIASES } from './navigation.js'

export function createAppRouter(history = createWebHistory()) {
  const router = createRouter({
    history,
    routes: [
      {
        path: '/',
        component: AppShell,
        children: [{ path: '', name: 'view-host', component: ViewHost }],
      },
      {
        path: '/download/android/:pathMatch(.*)*',
        component: AppShell,
        children: [{ path: '', name: 'android-download', component: ViewHost }],
      },
    ],
  })

  router.beforeEach((to) => {
    const view = to.query.view
    const canonical = canonicalView(view)
    if (canonical !== view && LEGACY_VIEW_ALIASES[view]) {
      return { path: to.path, query: { ...to.query, view: canonical }, replace: true }
    }
  })

  return router
}

export default createAppRouter()
