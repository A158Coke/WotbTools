import { EventEmitter } from 'node:events'
import { existsSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ spawn: vi.fn() }))
vi.mock('node:child_process', () => ({ spawn: mocks.spawn, spawnSync: vi.fn() }))
import { launchChromeForCdp } from './browser-chrome.mjs'
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); mocks.spawn.mockReset() })
describe('Chrome startup failure', () => {
  it('reports bounded sanitized stderr and removes the profile after an early exit', async () => {
    const child = Object.assign(new EventEmitter(), { pid: 123456, exitCode: null, signalCode: null, stderr: new EventEmitter(), kill: vi.fn() })
    let profile
    mocks.spawn.mockImplementation((_exe, args) => {
      profile = args.find(arg => arg.startsWith('--user-data-dir=')).slice('--user-data-dir='.length)
      setTimeout(() => { child.stderr.emit('data', Buffer.from(`${'x'.repeat(17000)} token=secret ${profile} https://example.com/private`)); child.exitCode = 7 }, 0)
      return child
    })
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true)
    let error
    try { await launchChromeForCdp('fake-chrome') } catch (caught) { error = caught }
    expect(error.message).toContain('exitCode=7 signal=null profile=present portFile=missing')
    expect(error.message).toContain('token=<redacted> <profile> <url>')
    expect(error.message).not.toContain('secret')
    expect(error.message.length).toBeLessThan(17000)
    expect(existsSync(profile)).toBe(false)
    if (process.platform !== 'win32') expect(kill).toHaveBeenCalledWith(-child.pid, 'SIGTERM')
  })
  it('reports spawn failures without leaving the temporary profile', async () => {
    const child = Object.assign(new EventEmitter(), { pid: undefined, exitCode: null, signalCode: null, stderr: new EventEmitter() })
    let profile
    mocks.spawn.mockImplementation((_exe, args) => {
      profile = args.find(arg => arg.startsWith('--user-data-dir=')).slice('--user-data-dir='.length)
      setTimeout(() => child.emit('error', Object.assign(new Error('missing'), { code: 'ENOENT' })), 0)
      return child
    })
    const error = await launchChromeForCdp('missing-chrome').catch(caught => caught)
    expect(error.message).toContain('Chrome spawn failed: ENOENT')
    expect(error.message).toContain('profile=present portFile=missing')
    expect(existsSync(profile)).toBe(false)
  })
  it('cleans up a timed-out process and its profile', async () => {
    vi.useFakeTimers()
    const child = Object.assign(new EventEmitter(), { pid: 123457, exitCode: null, signalCode: null, stderr: new EventEmitter(), kill: vi.fn() })
    let profile
    mocks.spawn.mockImplementation((_exe, args) => { profile = args.find(arg => arg.startsWith('--user-data-dir=')).slice('--user-data-dir='.length); return child })
    vi.spyOn(process, 'kill').mockImplementation(() => true)
    const outcome = launchChromeForCdp('fake-chrome').catch(error => error)
    await vi.advanceTimersByTimeAsync(33000)
    const error = await outcome
    expect(error.message).toContain('Chrome did not publish DevToolsActivePort within 30s')
    expect(error.message).toContain('exitCode=null signal=null profile=present portFile=missing')
    expect(existsSync(profile)).toBe(false)
  })
})
