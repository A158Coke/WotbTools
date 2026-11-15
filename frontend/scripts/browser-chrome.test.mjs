import { describe, expect, it } from 'vitest'
import { CdpClient } from './browser-chrome.mjs'

class Socket extends EventTarget {
  send(payload) { this.command = JSON.parse(payload) }
  close() { this.dispatchEvent(new Event('close')) }
}

describe('CDP disconnect during teardown', () => {
  it('rejects outstanding commands if Chrome closes before replying', async () => {
    const socket = new Socket()
    const client = new CdpClient(socket)
    const closing = client.send('Browser.close')
    const inFlight = client.send('Runtime.evaluate')
    socket.close()
    await expect(closing).rejects.toThrow('CDP websocket closed during Browser.close')
    await expect(inFlight).rejects.toThrow('CDP websocket closed during Runtime.evaluate')
    expect(client.pending.size).toBe(0)
    await expect(client.send('Target.createTarget')).rejects.toThrow('CDP websocket closed before Target.createTarget')
  })

  it('keeps a response that arrives before disconnection', async () => {
    const socket = new Socket()
    const client = new CdpClient(socket)
    const closing = client.send('Browser.close')
    socket.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ id: socket.command.id, result: {} }) }))
    socket.close()
    await expect(closing).resolves.toEqual({})
    expect(client.pending.size).toBe(0)
  })
})
