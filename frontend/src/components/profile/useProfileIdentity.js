/**
 * ProfilePage —— 身份展示派生态（拆分自 ProfilePage.vue，行为原样）。
 * hero 展示名 / realm 角色 / WG 身份判读 / 服务器标签 / Keycloak 用户 ID 复制。
 */
import { computed, onBeforeUnmount, ref } from 'vue'
import { copyText } from '../../utils/clipboard.js'

/** @param {{
 *  profile: import('vue').Ref<object|null>,
 *  tokenParsed: import('vue').Ref<object|null>,
 *  authDisplayName: import('vue').Ref<string>,
 *  authEpoch: () => number,
 *  ownEpoch: (epoch: number) => boolean,
 *  t: (key: string) => string,
 * }} ctx */
export function useProfileIdentity({ profile, tokenParsed, authDisplayName, authEpoch, ownEpoch, t }) {
  /** hero 展示名与顶栏同源：后端 Profile 的 displayName 优先，缺失才落到 useAuth.displayName。 */
  const displayName = computed(() =>
    profile.value?.displayName
    || authDisplayName.value
    || t('profile.unknownUser')
  )

  /** JWT 明确是 WG 登录（ASIA/EU/NA + 可信 verified + account_id），即使同步失败也据此只读。 */
  const isWargamingLogin = computed(() => {
    const region = tokenParsed.value?.wotb_region
    const accountId = tokenParsed.value?.wotb_account_id
    const verified = tokenParsed.value?.wotb_verified
    return ['ASIA', 'EU', 'NA'].includes(region)
      && Boolean(accountId)
      && (verified === true || verified === 'true')
  })

  const heroSubtitle = computed(() =>
    profile.value?.wotbNickname
      ? profile.value.wotbNickname
      : isWargamingLogin.value
        ? t('profile.wgSyncing')
        : t('profile.notBoundWotbAccount')
  )

  /**
   * 当前 token 的 realm 角色（`realm_access.roles`，Keycloak 已展开 composite），隐藏 Keycloak
   * 内置角色后按原始 key 展示。角色展示与权限判断都只认真实 token claims。
   */
  const KEYCLOAK_BUILTIN_ROLES = new Set(['offline_access', 'uma_authorization'])
  const realmRoles = computed(() => {
    const roles = tokenParsed.value?.realm_access?.roles
    if (!Array.isArray(roles)) return []
    return roles
      .filter(role => typeof role === 'string'
        && !KEYCLOAK_BUILTIN_ROLES.has(role)
        && !role.startsWith('default-roles-'))
      .sort()
  })

  const userIdCopied = ref(false)
  let userIdCopiedTimer = null
  let unmounted = false

  function resetUserIdCopied() {
    clearTimeout(userIdCopiedTimer)
    userIdCopied.value = false
  }

  async function copyUserId() {
    const id = profile.value?.keycloakUserId
    if (!id) return
    const epoch = authEpoch()
    const copied = await copyText(id)
    // 归属复核：A 时代在途的复制迟到完成时剪贴板里是 A 的 ID，不得在 B 的按钮上显示「已复制」；
    // 卸载后的迟到结果也不再起定时器。
    if (!copied || unmounted || !ownEpoch(epoch)) return
    userIdCopied.value = true
    clearTimeout(userIdCopiedTimer)
    userIdCopiedTimer = setTimeout(() => { userIdCopied.value = false }, 1500)
  }

  onBeforeUnmount(() => {
    unmounted = true
    clearTimeout(userIdCopiedTimer)
  })

  /** WARGAMING source 或 JWT WG 身份 = 资料只读；CN MANUAL 用户可编辑。 */
  const isWargamingProfile = computed(
    () => profile.value?.wotbAccountSource === 'WARGAMING'
      || isWargamingLogin.value
  )

  const SERVER_LABEL_BY_VALUE = Object.freeze({
    CN: 'profile.serverCn',
    ASIA: 'profile.serverAsia',
    EU: 'profile.serverEu',
    NA: 'profile.serverNa',
  })

  const serverLabel = computed(() => {
    const key = profile.value?.wotbServer
      ? SERVER_LABEL_BY_VALUE[profile.value.wotbServer]
      : null
    return key ? t(key) : '--'
  })

  return {
    displayName, heroSubtitle, realmRoles,
    userIdCopied, resetUserIdCopied, copyUserId,
    isWargamingLogin, isWargamingProfile, serverLabel,
  }
}
