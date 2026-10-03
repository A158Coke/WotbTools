// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ConnectivityState,
  createAndroidConnectivitySource,
  createBrowserConnectivitySource,
  createConnectivity,
  isOnlineState,
  normalizeConnectivityState,
  selectConnectivitySource,
} from './connectivity.js'
import { NATIVE_CONNECTIVITY_CHANGED_GLOBAL } from './nativeBridgeContract.js'

/** 与 usePlatformBridge.test.js 相同的 bridge 模拟：postMessage → 同 id 的 reply 事件。 */
function stubNative(results) {
  const listeners = []
  const calls = []
  window.WotbNative = {
    postMessage: vi.fn((json) => {
      const msg = JSON.parse(json)
      calls.push(msg.method)
      listeners.forEach(cb => cb({ data: JSON.stringify({ id: msg.id, result: results[msg.method] ?? null }) }))
    }),
    addEventListener: vi.fn((type, cb) => listeners.push(cb)),
    removeEventListener: vi.fn((type, cb) => {
      const i = listeners.indexOf(cb)
      if (i >= 0) listeners.splice(i, 1)
    }),
  }
  return { calls }
}

function fakeWindow(online = true) {
  const listeners = new Map()
  return {
    navigator: { onLine: online },
    addEventListener: (type, cb) => listeners.set(type, [...(listeners.get(type) || []), cb]),
    removeEventListener: (type, cb) => listeners.set(type, (listeners.get(type) || []).filter(x => x !== cb)),
    emit(type) {
      for (const cb of listeners.get(type) || []) cb()
    },
    listenerCount(type) {
      return (listeners.get(type) || []).length
    },
  }
}

describe('connectivity normalization', () => {
  afterEach(() => {
    delete window.WotbNative
    delete window[NATIVE_CONNECTIVITY_CHANGED_GLOBAL]
  })

  it('normalizes known tokens and fail-closes everything else', () => {
    expect(normalizeConnectivityState('ONLINE')).toBe(ConnectivityState.ONLINE)
    expect(normalizeConnectivityState(' offline ')).toBe(ConnectivityState.OFFLINE)
    expect(normalizeConnectivityState(true)).toBe(ConnectivityState.ONLINE)
    expect(normalizeConnectivityState(false)).toBe(ConnectivityState.OFFLINE)
    // 未知 / 缺失 / 类型不符一律 UNKNOWN —— 绝不猜成 online。
    for (const raw of ['degraded', 'service-unavailable', 'nonsense', '', null, undefined, 42, {}]) {
      const state = normalizeConnectivityState(raw)
      expect([ConnectivityState.DEGRADED, ConnectivityState.SERVICE_UNAVAILABLE,
        ConnectivityState.UNKNOWN].includes(state), String(raw)).toBe(true)
    }
  })

  it('only an explicit online token counts as online', () => {
    expect(isOnlineState(ConnectivityState.ONLINE)).toBe(true)
    for (const state of [ConnectivityState.OFFLINE, ConnectivityState.DEGRADED,
      ConnectivityState.SERVICE_UNAVAILABLE, ConnectivityState.UNKNOWN]) {
      expect(isOnlineState(state), state).toBe(false)
    }
  })
})

describe('connectivity sources', () => {
  afterEach(() => {
    delete window.WotbNative
    delete window[NATIVE_CONNECTIVITY_CHANGED_GLOBAL]
  })

  it('browser source reads navigator.onLine and reacts to window events', () => {
    const target = fakeWindow(true)
    const source = createBrowserConnectivitySource(target)
    const seen = []
    const unsubscribe = source.subscribe(next => seen.push(next))

    expect(source.read()).toBe(ConnectivityState.ONLINE)
    target.navigator.onLine = false
    target.emit('offline')
    target.navigator.onLine = true
    target.emit('online')
    expect(seen).toEqual([ConnectivityState.OFFLINE, ConnectivityState.ONLINE])

    unsubscribe()
    expect(target.listenerCount('online')).toBe(0)
    expect(target.listenerCount('offline')).toBe(0)
  })

  it('browser source reports UNKNOWN when the API is unavailable', () => {
    const source = createBrowserConnectivitySource({})
    expect(source.read()).toBe(ConnectivityState.UNKNOWN)
    expect(source.subscribe(() => {})).toBeTypeOf('function')
  })

  it('android source reads the native state over the bridge', async () => {
    const { calls } = stubNative({ connectivityGetState: 'offline' })
    const source = createAndroidConnectivitySource()
    await expect(source.read()).resolves.toBe(ConnectivityState.OFFLINE)
    expect(calls).toEqual(['connectivityGetState'])
  })

  it('android source re-reads native state on push (no payload trust)', async () => {
    stubNative({ connectivityGetState: 'online' })
    const source = createAndroidConnectivitySource()
    const seen = []
    const unsubscribe = source.subscribe(next => seen.push(next))
    // Native 推送不带 payload：页面必须回读，事件本身不是事实源。
    await window[NATIVE_CONNECTIVITY_CHANGED_GLOBAL]()
    expect(seen).toEqual([ConnectivityState.ONLINE])
    unsubscribe()
    expect(window[NATIVE_CONNECTIVITY_CHANGED_GLOBAL]).toBeUndefined()
  })

  it('a failing or malformed native reply degrades to UNKNOWN and keeps processing later events', async () => {
    // review §12：事件 handler 的返回值没人接 ⇒ 桥报错 / 回复畸形 / 超时都必须自己兜住，
    // 规范化为 UNKNOWN（绝不算在线），且不能中断后续事件。
    let mode = 'null'
    const listeners = []
    window.WotbNative = {
      postMessage: (json) => {
        const msg = JSON.parse(json)
        if (msg.method !== 'connectivityGetState') return
        if (mode === 'throw') throw new Error('bridge exploded')
        const result = mode === 'malformed' ? { unexpected: true } : null
        listeners.forEach(cb => cb({ data: JSON.stringify({ id: msg.id, result }) }))
      },
      addEventListener: (type, cb) => listeners.push(cb),
      removeEventListener: () => {},
    }

    const source = createAndroidConnectivitySource()
    const seen = []
    const unsubscribe = source.subscribe(next => seen.push(next))

    // null / malformed / throw 三种失败形态 → 全部 UNKNOWN，且不抛 unhandled rejection。
    for (const failing of ['null', 'malformed', 'throw']) {
      mode = failing
      await expect(window[NATIVE_CONNECTIVITY_CHANGED_GLOBAL]()).resolves.toBeUndefined()
    }
    expect(seen).toEqual([ConnectivityState.UNKNOWN, ConnectivityState.UNKNOWN, ConnectivityState.UNKNOWN])

    // 后续事件仍然被处理：桥恢复后能重新报告 online。
    mode = 'online'
    window.WotbNative.postMessage = (json) => {
      const msg = JSON.parse(json)
      if (msg.method === 'connectivityGetState') {
        listeners.forEach(cb => cb({ data: JSON.stringify({ id: msg.id, result: 'online' }) }))
      }
    }
    await window[NATIVE_CONNECTIVITY_CHANGED_GLOBAL]()
    expect(seen[3]).toBe(ConnectivityState.ONLINE)
    unsubscribe()
  })

  it('missing bridge resolves to UNKNOWN instead of guessing online', async () => {
    const source = createAndroidConnectivitySource()
    await expect(source.read()).resolves.toBe(ConnectivityState.UNKNOWN)
  })

  it('selects the native source only when the shell advertises the capability', () => {
    expect(selectConnectivitySource({ android: true, capabilities: ['connectivity'] }).name).toBe('android')
    expect(selectConnectivitySource({ android: true, capabilities: ['native-auth'] }).name).toBe('browser')
    expect(selectConnectivitySource({ android: false, capabilities: [] }).name).toBe('browser')
  })
})

describe('connectivity store', () => {
  it('notifies subscribers with the current state first, then deduped changes', () => {
    const source = { name: 'test', read: () => ConnectivityState.ONLINE, subscribe: () => () => {} }
    const connectivity = createConnectivity({ source })
    const seen = []
    connectivity.subscribe(state => seen.push(state))

    expect(seen).toEqual([ConnectivityState.UNKNOWN])
    connectivity.setState(ConnectivityState.ONLINE)
    connectivity.setState(ConnectivityState.ONLINE)
    connectivity.setState(ConnectivityState.OFFLINE)
    expect(seen).toEqual([ConnectivityState.UNKNOWN, ConnectivityState.ONLINE, ConnectivityState.OFFLINE])
    expect(connectivity.isOnline()).toBe(false)
  })

  it('offline → online → offline drives capability updates synchronously', async () => {
    let emit = () => {}
    const source = {
      name: 'test',
      read: () => ConnectivityState.OFFLINE,
      subscribe: (onChange) => {
        emit = onChange
        return () => {}
      },
    }
    const connectivity = createConnectivity({ source })
    await connectivity.start()
    expect(connectivity.state).toBe(ConnectivityState.OFFLINE)

    const seen = []
    connectivity.subscribe(state => seen.push(state))
    emit(ConnectivityState.ONLINE)
    expect(connectivity.state).toBe(ConnectivityState.ONLINE)
    emit(ConnectivityState.OFFLINE)
    expect(connectivity.state).toBe(ConnectivityState.OFFLINE)
    expect(seen).toEqual([ConnectivityState.OFFLINE, ConnectivityState.ONLINE, ConnectivityState.OFFLINE])
  })

  it('start() is idempotent and stop() detaches the source', async () => {
    const unsubscribe = vi.fn()
    const read = vi.fn(() => ConnectivityState.ONLINE)
    const connectivity = createConnectivity({ source: { name: 'test', read, subscribe: () => unsubscribe } })

    await connectivity.start()
    await connectivity.start()
    expect(read).toHaveBeenCalledTimes(1)
    connectivity.stop()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('a throwing subscriber cannot break the state machine', () => {
    const connectivity = createConnectivity({ source: { name: 'test', read: () => 'online', subscribe: () => () => {} } })
    const seen = []
    connectivity.subscribe(() => {
      throw new Error('boom')
    })
    connectivity.subscribe(state => seen.push(state))
    expect(() => connectivity.setState(ConnectivityState.OFFLINE)).not.toThrow()
    expect(seen).toEqual([ConnectivityState.UNKNOWN, ConnectivityState.OFFLINE])
  })
})
