import { computed, onBeforeUnmount, ref } from 'vue'
import type { Ref } from 'vue'
import type { components } from '../../api/generated/http-contract.js'
import type { AuthClaims } from '../../types/auth.js'
import type { useI18n } from 'vue-i18n'
import { copyText } from '../../utils/clipboard.js'

type UserProfile = components['schemas']['UserProfile']
type Translate = ReturnType<typeof useI18n>['t']
type IdentityContext = {
  profile: Ref<UserProfile | null>
  tokenParsed: Ref<AuthClaims | null>
  authDisplayName: Ref<string>
  authEpoch: () => number
  ownEpoch: (epoch: number) => boolean
  t: Translate
}

/** @param {{
 *  profile: import('vue').Ref<object|null>,
 *  tokenParsed: import('vue').Ref<object|null>,
 *  authDisplayName: import('vue').Ref<string>,
 *  authEpoch: () => number,
 *  ownEpoch: (epoch: number) => boolean,
 *  t: (key: string) => string,
 * }} ctx */
export function useProfileIdentity({ profile, tokenParsed, authDisplayName, authEpoch, ownEpoch, t }: IdentityContext) {
  const displayName = computed(() =>
    profile.value?.displayName
    || authDisplayName.value
    || t('profile.unknownUser')
  )

  const isWargamingLogin = computed(() => {
    const region = tokenParsed.value?.wotb_region
    const accountId = tokenParsed.value?.wotb_account_id
    const verified = tokenParsed.value?.wotb_verified
    return typeof region === 'string' && ['ASIA', 'EU', 'NA'].includes(region)
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
  let userIdCopiedTimer: ReturnType<typeof setTimeout> | null = null
  let unmounted = false

  function resetUserIdCopied() {
    if (userIdCopiedTimer !== null) clearTimeout(userIdCopiedTimer)
    userIdCopied.value = false
  }

  async function copyUserId() {
    const id = profile.value?.keycloakUserId
    if (!id) return
    const epoch = authEpoch()
    const copied = await copyText(id)
    if (!copied || unmounted || !ownEpoch(epoch)) return
    userIdCopied.value = true
    if (userIdCopiedTimer !== null) clearTimeout(userIdCopiedTimer)
    userIdCopiedTimer = setTimeout(() => { userIdCopied.value = false }, 1500)
  }

  onBeforeUnmount(() => {
    unmounted = true
    if (userIdCopiedTimer !== null) clearTimeout(userIdCopiedTimer)
  })

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
