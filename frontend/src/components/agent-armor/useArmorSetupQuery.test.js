import { beforeEach, describe, expect, it, vi } from 'vitest'

const { route, router } = vi.hoisted(() => ({
  route: { query: { tank: '123', shell: '2', config: '0', eqcal: '0' } },
  router: { replace: vi.fn() },
}))

vi.mock('vue-router', () => ({ useRoute: () => route, useRouter: () => router }))

import { useArmorSetupQuery } from './useArmorSetupQuery.ts'

describe('native armor viewer controls URL synchronization', () => {
  beforeEach(() => {
    router.replace.mockReset()
    route.query = { tank: '123', shell: '2', config: '0', eqcal: '0' }
  })

  it('writes the selected target config to the URL and preserves the shell', () => {
    const setup = useArmorSetupQuery({ viewer: () => null, targetSetupId: () => 123, shooterSetupId: () => 456, onUpgradesChanged() {} })
    setup.syncNativeTargetConfig('3')

    expect(router.replace).toHaveBeenCalledWith({ query: { tank: '123', shell: '2', config: '3', eqcal: '0' } })
  })

  it('writes shell and supported equipment selections, while rejecting invalid inputs', () => {
    const setup = useArmorSetupQuery({ viewer: () => null, targetSetupId: () => 123, shooterSetupId: () => 456, onUpgradesChanged() {} })
    setup.syncNativeShell('4')
    setup.syncNativeEquipment('calibrated', true)
    setup.syncNativeEquipment('unsupported', true)
    setup.syncNativeTargetConfig('-1')

    expect(router.replace).toHaveBeenCalledTimes(2)
    expect(router.replace).toHaveBeenNthCalledWith(1, { query: { tank: '123', shell: '4', config: '0', eqcal: '0' } })
    expect(router.replace).toHaveBeenNthCalledWith(2, { query: { tank: '123', shell: '4', config: '0', eqcal: '1' } })
  })
})
