import { ref } from 'vue'
import { getUserHofRecords } from '../../api/hall-of-fame.js'

/** @param {{ requireHofOnline: () => boolean, ownEpoch: (epoch: number) => boolean, epochArg: (v: unknown) => number, apiError: (error: unknown) => string }} ctx */
export function useProfileRecords({ requireHofOnline, ownEpoch, epochArg, apiError }: {
  requireHofOnline: () => boolean
  ownEpoch: (epoch: number) => boolean
  epochArg: (value: unknown) => number
  apiError: (error: unknown) => string
}) {
  const records = ref<Awaited<ReturnType<typeof getUserHofRecords>>>([])
  const recordsError = ref('')

  async function loadRecords(epochInput: unknown) {
    const epoch = epochArg(epochInput)
    if (!ownEpoch(epoch)) return
    if (!requireHofOnline()) return
    recordsError.value = ''
    try {
      const fetchedRecords = await getUserHofRecords()
      if (!ownEpoch(epoch)) return
      records.value = fetchedRecords
    } catch (error) {
      if (ownEpoch(epoch)) recordsError.value = apiError(error)
    }
  }

  function reset() {
    records.value = []
    recordsError.value = ''
  }

  return { records, recordsError, loadRecords, reset }
}
