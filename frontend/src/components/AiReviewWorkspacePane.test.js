// @vitest-environment happy-dom
/**
 * AI 复盘 pane 的错误归属：Agent 产物身份不一致必须是**独立**文案
 * （`workspace.ai_engine_version_mismatch`），不能被通用
 * 「引擎加载失败 / 解析失败」吞掉——用户按提示刷新即可拿到与本 build
 * 同 identity 的 Agent 产物。stale WASM 的原始症状是 AI Review 报
 * `ai_review.poses 缺失`，本测试锁定它不再走到那一步。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

import { AgentWasmVersionMismatchError } from '../api/agent-replay-facets.js'
import { AiProjectionUnavailableError } from '../replay-local/ai/index.js'
import { ReplayEngineUnavailableError } from '../replay-local/parseReplays.js'
import AiReviewWorkspacePane from './AiReviewWorkspacePane.vue'

const buildLocalAiReviewInput = vi.fn()

// 连通性替身（分支侧：AI / 3D 入口先过 capability 门禁）。
const connectivityState = vi.hoisted(() => ({ state: null }))
vi.mock('../composables/useConnectivity.js', async () => {
  const { ref } = await import('vue')
  connectivityState.state = ref('online')
  connectivityState.settled = ref(true)
  return { useConnectivity: () => ({ connectivity: connectivityState.state, settled: connectivityState.settled, isSettled: () => connectivityState.settled.value, whenSettled: () => Promise.resolve() }) }
})

// 认证替身（main 侧：退出登录会使在途投影失效，重新登录后重建）。
const auth = vi.hoisted(() => ({ authenticated: null, login: vi.fn() }))
vi.mock('../composables/useAuth.js', async () => {
  const { ref } = await import('vue')
  auth.authenticated = ref(true)
  return { useAuth: () => auth }
})

// pane 用 useI18n().t 解析 errorKey；组件本体不挂 i18n 插件，这里返回 key 本身
vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key) => key, te: () => true, locale: { value: 'zh' } }),
}))

vi.mock('../replay-local/ai/index.js', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    buildLocalAiReviewInput: (...args) => buildLocalAiReviewInput(...args),
  }
})

function mountPane(props = {}) {
  return mount(AiReviewWorkspacePane, {
    props: { file: { name: 'a.wotbreplay' }, active: true, ...props },
    global: {
      mocks: { $t: (key) => key },
      stubs: {
        AiReviewPanel: {
          name: 'AiReviewPanel',
          props: ['projectionError', 'projection'],
          template: '<div class="panel-stub" :data-error="projectionError" />',
        },
      },
    },
  })
}

async function projectionErrorFor(error) {
  buildLocalAiReviewInput.mockReset()
  buildLocalAiReviewInput.mockRejectedValue(error)
  const wrapper = mountPane()
  await flushPromises()
  const errorKey = wrapper.find('.panel-stub').attributes('data-error')
  wrapper.unmount()
  return errorKey
}

beforeEach(() => {
  auth.authenticated.value = true
  auth.login.mockReset()
  connectivityState.state.value = 'online'
  buildLocalAiReviewInput.mockReset()
})

describe('AiReviewWorkspacePane authenticated use', () => {
  it.each(['', 'select one replay'])('anonymous sees login gate before projection work (blocked=%s)', async (blockedReason) => {
    auth.authenticated.value = false
    const wrapper = mountPane({ blockedReason })
    await flushPromises()
    expect(wrapper.find('[data-testid="ai-login-required"]').exists()).toBe(true)
    expect(wrapper.find('.panel-stub').exists()).toBe(false)
    expect(buildLocalAiReviewInput).not.toHaveBeenCalled()
    await wrapper.get('[data-testid="ai-login"]').trigger('click')
    expect(auth.login).toHaveBeenCalledWith('ai-review')
    wrapper.unmount()
  })

  it('login builds selected replay; logout discards late projection and relogin rebuilds it', async () => {
    auth.authenticated.value = false
    let finishOld
    buildLocalAiReviewInput.mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve }))
    const wrapper = mountPane()
    const file = wrapper.props('file')
    auth.authenticated.value = true
    await flushPromises()
    expect(buildLocalAiReviewInput).toHaveBeenCalledWith(file)
    auth.authenticated.value = false
    await flushPromises()
    expect(wrapper.find('.panel-stub').exists()).toBe(false)
    finishOld({ old: true })
    await flushPromises()
    const fresh = { fresh: true }
    buildLocalAiReviewInput.mockResolvedValueOnce(fresh)
    auth.authenticated.value = true
    await flushPromises()
    expect(buildLocalAiReviewInput).toHaveBeenCalledTimes(2)
    expect(wrapper.findComponent({ name: 'AiReviewPanel' }).props('projection')).toEqual(fresh)
    expect(wrapper.props('file')).toBe(file)
    wrapper.unmount()
  })
})

describe('AiReviewWorkspacePane 错误归属', () => {
  it('Agent 版本不一致 → workspace.ai_engine_version_mismatch（独立文案，优先于通用引擎错误）', async () => {
    const mismatch = new AgentWasmVersionMismatchError({
      expectedRelease: 'v0.3.9',
      expectedCommit: 'b4e50e13581b8383b1332fbc7ba7b402116533bd',
      actualRelease: 'v0.3.8',
      actualCommit: 'f35baa46ec4d069c8d68cfad66cafcd166e0a492',
      reason: 'upstream_commit 与 build 期 pin 不一致',
    })
    expect(await projectionErrorFor(mismatch)).toBe('workspace.ai_engine_version_mismatch')
    // 错误对象必须携带可诊断的四个字段（日志/排障用）
    expect(mismatch.expectedRelease).toBe('v0.3.9')
    expect(mismatch.expectedCommit).toBe('b4e50e13581b8383b1332fbc7ba7b402116533bd')
    expect(mismatch.actualRelease).toBe('v0.3.8')
    expect(mismatch.actualCommit).toBe('f35baa46ec4d069c8d68cfad66cafcd166e0a492')
  })

  it('引擎装载失败 → workspace.ai_engine_unavailable', async () => {
    expect(await projectionErrorFor(new ReplayEngineUnavailableError('wasm missing')))
      .toBe('workspace.ai_engine_unavailable')
  })

  it('时间轴不可用 → workspace.ai_projection_unavailable', async () => {
    expect(await projectionErrorFor(new AiProjectionUnavailableError()))
      .toBe('workspace.ai_projection_unavailable')
  })
})

describe('AiReviewWorkspacePane connectivity gating', () => {
  it('offline AI entry gives connectivity before login/projection, and reconnect never submits AI', async () => {
    buildLocalAiReviewInput.mockReset().mockResolvedValue({ battle: {}, projection: {} })
    connectivityState.state.value = 'offline'
    const wrapper = mountPane()
    await flushPromises()
    expect(wrapper.find('[data-testid="ai-connectivity"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="ai-login"]').exists()).toBe(false)
    expect(buildLocalAiReviewInput).not.toHaveBeenCalled()
    connectivityState.state.value = 'online'
    await flushPromises()
    expect(buildLocalAiReviewInput).toHaveBeenCalledTimes(1)
    expect(wrapper.find('.panel-stub').exists()).toBe(true)
    wrapper.unmount()
  })
})
