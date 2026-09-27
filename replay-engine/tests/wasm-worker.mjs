// Module Web Worker entry: proves the engine loads and parses inside a worker context, which is
// how the Vue runtime will call it (see the Web Runtime milestone).

import init, { parse_result } from '../crates/replay-wasm/pkg-web/replay_wasm.js'

self.onmessage = async (event) => {
  try {
    await init()
    const result = JSON.parse(parse_result(new Uint8Array(event.data)))
    self.postMessage({
      ok: true,
      arenaId: result.arena_id,
      participants: result.participants.length,
    })
  } catch (error) {
    self.postMessage({ ok: false, error: String(error) })
  }
}
