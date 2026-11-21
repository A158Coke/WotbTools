/**
 * ProfilePage —— CN 手动账户的绑定 / 改绑 / 回放验证 / 解绑（拆分自 ProfilePage.vue，行为原样）。
 */
import { ref } from 'vue'
import type { Ref } from 'vue'
import type { components } from '../../api/generated/http-contract.js'
import type { useI18n } from 'vue-i18n'
import {
  deleteUserWotbAccount,
  updateUserWotbAccount,
  verifyUserWotbAccountFromReplay,
} from '../../api/user-profile.js'
import { replayRecorderAccountId } from '../../replay-local/submissionFacts.js'

type UserProfile = components['schemas']['UserProfile']
type Translate = ReturnType<typeof useI18n>['t']
type WotbAccountContext = {
  profile: Ref<UserProfile | null>
  requireProfileOnline: () => boolean
  ownEpoch: (epoch: number) => boolean
  authEpoch: () => number
  apiError: (error: unknown) => string
  loadRecords: (epoch?: number) => Promise<void>
  loadHundredStatus: (epoch?: number) => Promise<void>
  confirm: (options: { title: string; confirmLabel: string; danger: boolean }) => Promise<boolean>
  t: Translate
}

/** @param {{
 *  profile: import('vue').Ref<object|null>,
 *  requireProfileOnline: () => boolean,
 *  ownEpoch: (epoch: number) => boolean,
 *  authEpoch: () => number,
 *  apiError: (error: unknown) => string,
 *  loadRecords: (epoch?: number) => Promise<void>,
 *  loadHundredStatus: (epoch?: number) => Promise<void>,
 *  confirm: (options: unknown) => Promise<boolean>,
 * }} ctx */
export function useProfileWotbAccount({
  profile, requireProfileOnline, ownEpoch, authEpoch, apiError, loadRecords, loadHundredStatus, confirm, t,
}: WotbAccountContext) {
  const editingAccount = ref(false)
  const editAccountId = ref<number | null>(null)
  const editNickname = ref('')
  const editError = ref('')
  /** 用回放验证：本机解析选中的回放，提交录像者 accountId（服务器不解析回放） */
  const verifyInput = ref<File | null>(null)
  const verifyPending = ref(false)
  const verifyError = ref('')

  function startEditAccount() {
    editAccountId.value = profile.value?.wotbAccountId || null
    editNickname.value = profile.value?.wotbNickname || ''
    editingAccount.value = true
    editError.value = ''
  }

  async function saveAccount() {
    if (!requireProfileOnline()) return
    const epoch = authEpoch()
    editError.value = ''
    try {
      const updated = await updateUserWotbAccount({
        wotbAccountId: editAccountId.value,
        wotbNickname: editNickname.value,
        wotbServer: 'CN'
      })
      if (!ownEpoch(epoch)) return
      profile.value = updated
      editingAccount.value = false
      loadRecords(epoch)
      loadHundredStatus(epoch)
    } catch (e) {
      if (!ownEpoch(epoch)) return
      editError.value = apiError(e)
    }
  }

  async function verifyWithReplay(event: Event) {
    const target = event.target instanceof HTMLInputElement ? event.target : null
    const file = target?.files?.[0]
    if (target) target.value = ''
    if (!file || verifyPending.value) return
    // 门禁放在最前：本地解析是 LOCAL 能力，但「用回放验证账号」最终要打 backend verify，
    // 离线时先提示，避免用户选完文件才发现无法提交。
    if (!requireProfileOnline()) return
    const epoch = authEpoch()
    verifyPending.value = true
    verifyError.value = ''
    try {
      const recorderAccountId = await replayRecorderAccountId(file)
      if (!ownEpoch(epoch)) return
      if (!requireProfileOnline()) return
      const verified = await verifyUserWotbAccountFromReplay(recorderAccountId)
      if (!ownEpoch(epoch)) return
      profile.value = verified
    } catch (e) {
      if (!ownEpoch(epoch)) return
      verifyError.value = apiError(e)
    } finally {
      if (ownEpoch(epoch)) verifyPending.value = false
    }
  }

  async function removeAccount() {
    if (!requireProfileOnline()) return
    const epoch = authEpoch()
    if (!(await confirm({ title: t('profile.unbindConfirm'), confirmLabel: t('profile.unbind'), danger: true }))) return
    if (!ownEpoch(epoch) || !requireProfileOnline()) return
    editError.value = ''
    try {
      const updated = await deleteUserWotbAccount()
      if (!ownEpoch(epoch)) return
      profile.value = updated
    } catch (e) {
      if (!ownEpoch(epoch)) return
      editError.value = apiError(e)
    }
  }

  function reset() {
    editingAccount.value = false
    editAccountId.value = null
    editNickname.value = ''
    editError.value = ''
    verifyPending.value = false
    verifyError.value = ''
  }

  return {
    editingAccount, editAccountId, editNickname, editError,
    startEditAccount, saveAccount,
    verifyInput, verifyPending, verifyError, verifyWithReplay,
    removeAccount, reset,
  }
}
