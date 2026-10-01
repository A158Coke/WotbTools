import { createRouter, createWebHistory } from 'vue-router'
import AppShell from './AppShell.vue'
import ViewHost from './ViewHost.vue'
import { canonicalView, LEGACY_VIEW_ALIASES, primarySection } from './navigation.js'

export function createAppRouter(history = createWebHistory()) {
  const router = createRouter({
    history,
    // 前进 / 后退恢复原位置；切换到另一个页面时回到顶部。回放工作台内的模式切换（replay / ai-review /
    // battle-playback）属于同一页面，不打断滚动位置。
    scrollBehavior(to, from, savedPosition) {
      if (savedPosition) return savedPosition
      const samePage = to.path === from.path
        && (to.query.view === from.query.view
          || (primarySection(to.query.view) === 'replay' && primarySection(from.query.view) === 'replay'))
      return samePage ? false : { top: 0 }
    },
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
      {
        path: '/sponsor',
        component: AppShell,
        children: [{ path: '', name: 'sponsor', component: ViewHost }],
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
