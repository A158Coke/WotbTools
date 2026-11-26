// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

const cache = vi.hoisted(() => ({ take: vi.fn() }))
vi.mock('../../replay-local/replayReloadCache.js', () => ({ takeReloadReplay: cache.take }))
vi.mock('../../replay-local/demo.js', () => ({ loadOfficialDemo: vi.fn() }))

import { installSceneState } from './sceneState.ts'
import { contactShadowOverrideFor } from '../../components/replay3dShadowRequest.ts'
import { restoreStagedReplay } from '../../composables/useReplayReloadRestore.ts'

const fileA = new File(['a'], 'a.wotbreplay')
const fileB = new File(['b'], 'b.wotbreplay')

function makeHost() {
  return {
    store: {
      speed: 1,
      qualityKey: 'high',
      qualityLabel: '',
      logdepth: false,
      dynres: true,
      armorHighlight: false,
      contactShadows: false,
    },
    perf: { interrupt: vi.fn() },
    scene: null,
    sunLight: null,
    rendererCaps: null,
  } as any
}

/** 与真实宿主一致：只有恢复请求绑定到当前场景 File 时，才把阴影目标交给场景。 */
function sceneFor(file: File, request: ReturnType<typeof makeRequest> | null) {
  const S = makeHost()
  installSceneState(S, contactShadowOverrideFor(file, request))
  return S
}

function makeRequest(file: File, contactShadows: boolean) {
  return { id: 'reload-a', file, contactShadows }
}

function deps(overrides: Record<string, unknown> = {}) {
  const files = ref<File[]>([])
  const selectionRevision = ref(0)
  const d = {
    files,
    selectionRevision,
    updateFiles: vi.fn((next: File[]) => { files.value = next.slice() }),
    updateDemoFile: vi.fn(),
    selectBattleIndex: vi.fn(),
    analyze: vi.fn().mockResolvedValue({ completed: true }),
    onRestoring: vi.fn(),
    onRestored: vi.fn(),
    onError: vi.fn(),
    ...overrides,
  }
  return d
}

describe('接地阴影恢复绑定到恢复 File', () => {
  beforeEach(() => {
    cache.take.mockReset()
    localStorage.clear()
    window.history.replaceState({}, '', '/replay')
  })

  it('正常路径：A 的暂存记录恢复后，A 场景接地阴影开启', async () => {
    cache.take.mockResolvedValue({
      id: 'reload-a',
      replay: { kind: 'files', files: [fileA], currentIndex: 0, contactShadows: true },
    })
    const d = deps()

    await expect(restoreStagedReplay(d as any)).resolves.toBe(true)
    expect(d.onError).not.toHaveBeenCalled()
    const [file, id, contactShadows] = d.onRestoring.mock.calls[0]
    expect(file).toBe(fileA)
    expect(id).toBe('reload-a')
    expect(contactShadows).toBe(true)

    const request = { id, file, contactShadows }
    expect(sceneFor(fileA, request).store.contactShadows).toBe(true)
    expect(sceneFor(fileB, request).store.contactShadows).toBe(false)
  })

  it('竞态路径：延迟恢复 A 期间用户打开 B，B 场景接地阴影必须关闭', async () => {
    let finishAnalyze: (value: unknown) => void = () => {}
    const analyze = vi.fn(() => new Promise(resolve => { finishAnalyze = resolve }))
    const d = deps({ analyze })
    cache.take.mockResolvedValue({
      id: 'reload-a',
      replay: { kind: 'files', files: [fileA], currentIndex: 0, contactShadows: true },
    })

    const pending = restoreStagedReplay(d as any)
    await vi.waitFor(() => expect(d.onRestoring).toHaveBeenCalled())
    const [file, id, contactShadows] = d.onRestoring.mock.calls[0]
    expect(file).toBe(fileA)
    expect(contactShadows).toBe(true)

    // A 的 analyze 仍被延迟；此时用户主动选择 B，旧页面还残留 ?shadows=1。
    d.files.value = [fileB]
    d.selectionRevision.value += 1
    window.history.replaceState({}, '', '/replay?shadows=1')
    expect(sceneFor(fileB, { id, file, contactShadows }).store.contactShadows).toBe(false)

    finishAnalyze({ completed: true })
    await expect(pending).resolves.toBe(true)
  })
})
