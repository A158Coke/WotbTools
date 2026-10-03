/**
 * Browser fixture for the playback parse Worker boundary.
 *
 * 只替换「解析 Worker 从哪里来」——`replaySource` 的请求结算、abort、看门狗、迟到回包
 * 全部是**生产代码**；真实应用、真实 Chrome、真实点击、真实 File 选择也都不替换。
 *
 * 为什么需要它：`browser-workspace-interaction` 的 A → 清空 → B 回归必须让 A 的解析
 * **确定性地停在 pending**（不能靠真实网络随机卡顿，更不能先等 A settle 再清空）。
 * 真实 WASM 产物在 fixture server 里不存在（`common/assets/wasm` 是 gitignore 的构建
 * 输入），所以真解析必然立刻失败——无法表达「在途」。这个 stub 提供闸门：
 *
 * - `holdRequests`（默认 true）：解析请求只登记、不回包 → A 真实停在 in-flight；
 * - `terminate()`：记录被终止（`replaySource` 在 abort / 看门狗时整体放弃 Worker）；
 * - `releaseResponses()`：放行已登记的请求（含**已被放弃**的 A——用来证明迟到回包
 *   无人认领、不污染当前会话）；
 * - `unclaimedAfterRelease()`：放行后仍无人认领的请求数（>0 即证明迟到回包被忽略）。
 *
 * 测试经 `window.__pbWorkerFixture`（main world）驱动这些 stub；主线程那一侧由
 * `replaySource` 的 `?debug` 注入点 `__setParseWorkerForTest(factory)` 提供。
 */

/** 最小合法 PlaybackData（契约 v2：validateAgentPlayback 通过，空场次即可） */
export function v2PlaybackJson() {
  return JSON.stringify({
    version: 2,
    meta: {
      map_id: 3, map_name: 'Middleburg', winner_team: 1, friendly_team: 2,
      author_eid: 7, t_start: 0, samples: 0, duration: 0,
    },
    vehicles: [], shots: [], kills: [], periods: [], visibility: [],
    supremacy_bases: [], supremacy_points: [],
  })
}

/**
 * 假 Worker：与真实 Worker 同形（`onmessage` / `onerror` / `postMessage` / `terminate`），
 * 走 `replaySource.wireParseWorker` 的同一条装配路径。
 */
export function createParseWorkerStub() {
  const stub = {
    onmessage: null,
    onerror: null,
    /** 收到过的解析请求（顺序 = 发起顺序） */
    requests: [],
    /** terminate() 调用次数：abort / 看门狗「整体放弃 Worker」的可观测证据 */
    terminations: 0,
    /** 是否把解析请求挂住不回包（测试闸门） */
    holdRequests: true,
    heldJson: v2PlaybackJson(),
    /** 放行后仍无人认领的请求 id（迟到回包被忽略的证据） */
    unclaimed: [],

    postMessage(message) {
      stub.requests.push(message)
      if (!stub.holdRequests) respond(message)
    },

    terminate() {
      stub.terminations += 1
    },

    /** 放行全部已登记请求（含已被 abort 结算的：它们必须无人认领） */
    releaseResponses() {
      for (const request of stub.requests) respond(request)
    },

    /** 放行后仍无人认领的请求数 */
    unclaimedAfterRelease() {
      return stub.unclaimed.length
    },
  }

  function respond(message) {
    if (!message || typeof message.id !== 'number') return
    if (typeof stub.onmessage !== 'function') return
    // onmessage 返回 false = 生产代码没有认领这条回包（parsePending 里已无该 id）
    const handled = stub.onmessage({ data: { id: message.id, json: stub.heldJson } })
    if (handled === false) stub.unclaimed.push(message.id)
  }

  return stub
}

/**
 * 安装 main world 桥：只创建 stub 并把它们排进 `replaySource` 的测试注入点。
 * 不使用任意全局 monkey patch——注入点本身是 `replaySource` 的显式 `?debug` 契约。
 */
export function installParseWorkerFixture() {
  const workers = []
  window.__pbWorkerFixture = {
    workers,
    /** 当前（最近一次创建的）Worker */
    current: () => workers[workers.length - 1] || null,
    /** 全部 Worker 收到的请求总数 */
    requestCount: () => workers.reduce((sum, worker) => sum + worker.requests.length, 0),
    /** 全部 Worker 的 terminate 次数（每次「整体放弃」+1） */
    terminations: () => workers.reduce((sum, worker) => sum + worker.terminations, 0),
    /** 已放行的请求里仍无人认领的条数 */
    unclaimed: () => workers.reduce((sum, worker) => sum + worker.unclaimedAfterRelease(), 0),
    /** 每个 Worker 收到的请求 id（按创建顺序） */
    requestIds: () => workers.map((worker) => worker.requests.map((request) => request.id)),
  }
  return () => {
    const worker = createParseWorkerStub()
    workers.push(worker)
    return worker
  }
}
