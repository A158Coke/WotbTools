/**
 * AdminUsersPage —— 行展示格式化（拆分自 AdminUsersPage.vue，行为原样）。
 * 纯函数集合，只依赖 i18n 的 t；不持有状态。
 */
export function createAdminUsersRowPresenter(t) {
  /** 行主列：展示名 → Keycloak 用户名 → Keycloak ID（Keycloak 数据源的用户通常没有本地展示名）。 */
  function rowName(u) {
    return u.displayName || u.keycloakUsername || u.keycloakUserId || t('admin.unknownUser')
  }

  /** 绑定 / 状态徽标：Keycloak 已删除 > 无本地资料 > 未绑定游戏账号 > 已绑定。 */
  function rowState(u) {
    if (u.keycloakUserMissing) return { label: t('admin.kcUserMissing'), tone: 'is-warning' }
    if (!u.hasLocalProfile) return { label: t('admin.noLocalProfile'), tone: '' }
    // 本地资料在登录时即创建；真正的「绑定」是游戏账号（wotbAccountId），与个人资料页同一判据
    if (u.wotbAccountId == null) return { label: t('admin.unbound'), tone: '' }
    return { label: t('admin.bound'), tone: 'is-success' }
  }

  function fmtTime(s) {
    if (!s) return ''
    const d = new Date(s)
    if (Number.isNaN(d.getTime())) return ''
    const p = (n) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
  }

  return { rowName, rowState, fmtTime }
}
