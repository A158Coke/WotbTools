import { gunzipSync } from 'node:zlib'

export const AI_WIRE_LOCALE = 'zh-CN'

export const projectionA = Object.freeze({
  battle: Object.freeze({ id: 'battle-A' }),
  projection: Object.freeze({ id: 'proj-A' }),
})
export const projectionB = Object.freeze({
  battle: Object.freeze({ id: 'battle-B' }),
  projection: Object.freeze({ id: 'proj-B' }),
})

/**
 * ReplayAnalysisAction is replaced with its DOM contract so layout and click tests
 * share the same mount. Failure text and actions still use the real Banner/AppButton.
 */
export function mountAiReviewPanel(mount, AiReviewPanel, props = {}) {
  return mount(AiReviewPanel, {
    props: { file: { name: 'a.wotbreplay' }, ...props },
    global: {
      mocks: {
        $t: (key, params) => key === 'errors.diagnostic_id' ? `diagnostic:${params.id}` : key,
      },
      stubs: {
        ReplayAnalysisAction: {
          props: ['analyzing', 'disabled'],
          emits: ['analyze', 'cancel'],
          template: '<div class="ai-action">'
            + '<button class="lg ai-analyze" :disabled="analyzing || disabled" @click="$emit(&apos;analyze&apos;)">analyze</button>'
            + '<button v-if="analyzing" class="cancel ai-cancel" type="button" @click="$emit(&apos;cancel&apos;)">cancel</button>'
            + '</div>',
        },
        AnalysisResultPanel: {
          props: ['result'],
          template: '<div class="result-stub">{{ result.analysis }}</div>',
        },
      },
    },
  })
}

/** Request calls, excluding cancel endpoints. */
export function createRequestHelpers(aiReviewsUrl) {
  return {
    analyzeCalls(fetchMock) {
      return fetchMock.mock.calls.filter(([url]) => String(url) === aiReviewsUrl)
    },
    cancelCalls(fetchMock) {
      return fetchMock.mock.calls
        .filter(([url]) => String(url).includes('/cancel'))
        .map(([url]) => String(url))
    },
    cancelUrl(correlationId) {
      return `${aiReviewsUrl}/${encodeURIComponent(correlationId)}/cancel`
    },
  }
}

/** Decode the gzip request body back into JSON. */
export const requestBody = async call => JSON.parse(
  gunzipSync(new Uint8Array(await call[1].body.arrayBuffer())).toString('utf8'),
)

export function emptySseResponse() {
  return {
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: async () => ({ done: true, value: undefined }),
        releaseLock: () => {},
      }),
    },
  }
}

export const sseFrame = (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
export const sseEvent = (event, data) => new TextEncoder().encode(sseFrame(event, data))

/** Frame-driven SSE response with a fresh cursor and frame list per call. */
export function sseFromFrames(...frames) {
  let index = 0
  return {
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: async () => (index < frames.length
          ? { done: false, value: new TextEncoder().encode(frames[index++]) }
          : { done: true, value: undefined }),
        releaseLock: () => {},
      }),
    },
  }
}
