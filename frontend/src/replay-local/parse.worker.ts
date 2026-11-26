/// <reference lib="webworker" />
import { loadAgentWasmModule, parseAgentResultFromBytes } from '../api/agent-replay-facets.js'
import type { ParseMessage, ParseRequest } from './parseWorkerProtocol.js'

const post = (message: ParseMessage) => (self as DedicatedWorkerGlobalScope).postMessage(message)

self.onmessage = async (event: MessageEvent<ParseRequest>) => {
  try {
    await loadAgentWasmModule()
  } catch (error) {
    post({ type: 'fatal', error: error instanceof Error ? error.message : String(error) })
    return
  }
  const { files } = event.data
  for (let index = 0; index < files.length; index++) {
    const { name, bytes } = files[index]
    try {
      const result = await parseAgentResultFromBytes(new Uint8Array(bytes))
      post({ type: 'file', index, file: { name, result, error: null } })
    } catch (error) {
      post({ type: 'file', index, file: { name, result: null, error: error instanceof Error ? error.message : String(error) } })
    }
  }
  post({ type: 'done' })
}
