
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

export function createParseWorkerStub() {
  const stub = {
    onmessage: null,
    onerror: null,
    requests: [],
    terminations: 0,
    holdRequests: true,
    heldJson: v2PlaybackJson(),
    unclaimed: [],

    postMessage(message) {
      stub.requests.push(message)
      if (!stub.holdRequests) respond(message)
    },

    terminate() {
      stub.terminations += 1
    },

    releaseResponses() {
      for (const request of stub.requests) respond(request)
    },

    unclaimedAfterRelease() {
      return stub.unclaimed.length
    },
  }

  function respond(message) {
    if (!message || typeof message.id !== 'number') return
    if (typeof stub.onmessage !== 'function') return
    const handled = stub.onmessage({ data: { id: message.id, json: stub.heldJson } })
    if (handled === false) stub.unclaimed.push(message.id)
  }

  return stub
}

export function installParseWorkerFixture() {
  const workers = []
  window.__pbWorkerFixture = {
    workers,
    current: () => workers[workers.length - 1] || null,
    requestCount: () => workers.reduce((sum, worker) => sum + worker.requests.length, 0),
    terminations: () => workers.reduce((sum, worker) => sum + worker.terminations, 0),
    unclaimed: () => workers.reduce((sum, worker) => sum + worker.unclaimedAfterRelease(), 0),
    requestIds: () => workers.map((worker) => worker.requests.map((request) => request.id)),
  }
  return () => {
    const worker = createParseWorkerStub()
    workers.push(worker)
    return worker
  }
}
