/**
 * ProfilePage —— 「我的百场成绩」状态与撤销（拆分自 ProfilePage.vue，行为原样）。
 */
import { ref } from 'vue'
import { hofHundredCancel, hofHundredMyStatus } from '../../api/hall-of-fame.js'

type HundredStatus = Awaited<ReturnType<typeof hofHundredMyStatus>>
type HundredContext = {
  requireHofOnline: () => boolean
  ownEpoch: (epoch: number) => boolean
  epochArg: (value: unknown) => number
  authEpoch: () => number
  apiError: (error: unknown) => string
  t: (key: string) => string
  confirm: (options: { title: string; confirmLabel: string; danger: boolean }) => Promise<boolean>
}

/** @param {{
 *  requireHofOnline: () => boolean,
 *  ownEpoch: (epoch: number) => boolean,
 *  epochArg: (v: unknown) => number,
 *  authEpoch: () => number,
 *  apiError: (error: unknown) => string,
 *  t: (key: string) => string,
 *  confirm: (options: unknown) => Promise<boolean>,
 * }} ctx */
export function useProfileHundred({ requireHofOnline, ownEpoch, epochArg, authEpoch, apiError, t, confirm }: HundredContext) {
  const hundredStatus = ref<HundredStatus | null>(null)
  const hundredError = ref('')
  const hundredWithdrawingId = ref<number | null>(null)
  const hundredMessage = ref('')

  /** 个人中心「我的百场成绩」：当前认证 / 当前申请 / 最近拒绝。 */
  async function loadHundredStatus(epochInput: unknown) {
    const epoch = epochArg(epochInput)
    if (!ownEpoch(epoch)) return
    if (!requireHofOnline()) return
    hundredError.value = ''
    try {
      const fetchedStatus = await hofHundredMyStatus()
      if (!ownEpoch(epoch)) return
      hundredStatus.value = fetchedStatus
    } catch (error) {
      if (!ownEpoch(epoch)) return
      hundredStatus.value = null
      hundredError.value = apiError(error)
    }
  }

  /** 撤销当前待审核申请：确认后调用取消 API，成功后刷新状态。 */
  async function withdrawHundred(id: number) {
    if (!requireHofOnline()) return
    const epoch = authEpoch()
    if (!(await confirm({ title: t('hundred.withdrawConfirm'), confirmLabel: t('hundred.withdraw'), danger: true }))) return
    if (!ownEpoch(epoch) || !requireHofOnline()) return
    hundredWithdrawingId.value = id
    hundredMessage.value = ''
    hundredError.value = ''
    try {
      await hofHundredCancel(id)
      if (!ownEpoch(epoch)) return
      hundredMessage.value = t('hundred.withdrawSuccess')
      await loadHundredStatus(epoch)
    } catch (error) {
      if (!ownEpoch(epoch)) return
      hundredError.value = apiError(error)
    } finally {
      if (ownEpoch(epoch)) hundredWithdrawingId.value = null
    }
  }

  function reset() {
    hundredStatus.value = null
    hundredError.value = ''
    hundredWithdrawingId.value = null
    hundredMessage.value = ''
  }

  return { hundredStatus, hundredError, hundredWithdrawingId, hundredMessage, loadHundredStatus, withdrawHundred, reset }
}
