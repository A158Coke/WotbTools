import type { useI18n } from 'vue-i18n'
import type { components } from '../../api/generated/http-contract.js'

type AdminUserRow = components['schemas']['AdminUserPage']['items'][number]
type Translate = ReturnType<typeof useI18n>['t']

export function createAdminUsersRowPresenter(t: Translate) {
  function rowName(u: AdminUserRow) {
    return u.displayName || u.keycloakUsername || u.keycloakUserId || t('admin.unknownUser')
  }

  function rowState(u: AdminUserRow) {
    if (u.keycloakUserMissing) return { label: t('admin.kcUserMissing'), tone: 'is-warning' }
    if (!u.hasLocalProfile) return { label: t('admin.noLocalProfile'), tone: '' }
    if (u.wotbAccountId == null) return { label: t('admin.unbound'), tone: '' }
    return { label: t('admin.bound'), tone: 'is-success' }
  }

  function fmtTime(s: string | null | undefined) {
    if (!s) return ''
    const d = new Date(s)
    if (Number.isNaN(d.getTime())) return ''
    const p = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
  }

  return { rowName, rowState, fmtTime }
}
