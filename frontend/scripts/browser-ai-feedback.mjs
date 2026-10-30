import { randomUUID } from 'node:crypto'
import { writeFile, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createServer } from 'vite'
import { findChrome, launchChromeForCdp } from './browser-chrome.mjs'

// Isolated browser fixture uses the real components and generated HTTP validators;
// auth and connectivity are deterministic boundaries, and fetch records requests.
const root = process.cwd()
const name = `__feedback_fixture_${randomUUID()}`
const html = resolve(root, `${name}.html`)
const entry = resolve(root, `${name}.js`)
const delay = ms => new Promise(resolvePromise => setTimeout(resolvePromise, ms))
const plugin = {
  name: 'feedback-test-boundaries', enforce: 'pre',
  resolveId(source) {
    if (source.endsWith('/composables/useAuth.js')) return '\0feedback-auth'
    if (source.endsWith('/composables/useFeatureGate.js')) return '\0feedback-gate'
  },
  load(id) {
    if (id === '\0feedback-auth') return 'export const useAuth = () => ({ token: () => "test", ensureToken: async () => true })'
    if (id === '\0feedback-gate') return 'export const useFeatureGate = () => ({ requireFeature: () => window.testOnline !== false })'
  },
}
let server, chrome
try {
  await writeFile(html, `<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="app"></div><script type="module" src="/${name}.js"></script></body></html>`)
  await writeFile(entry, `
    import { createApp, h } from 'vue'
    import { createI18n } from 'vue-i18n'
    import AnalysisResultPanel from '/src/components/AnalysisResultPanel.vue'
    import AdminAiReviewFeedbackPage from '/src/components/AdminAiReviewFeedbackPage.vue'
    import messages from '/src/locales/feature-messages.json'
    window.requests = []
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async value => { window.copied = value } } })
    window.fetch = async (url, options = {}) => {
      window.requests.push({ url: String(url), options })
      if (window.failNext) { window.failNext = false; throw new TypeError('test network failure') }
      if (options.method === 'POST') return Response.json({ id: '1', createdAt: '2026-01-01T00:00:00Z' }, { status: 201 })
      if (options.method === 'DELETE') return new Response(null, { status: 204 })
      const row = { id: '1', reasonCodes: ['OTHER'], feedbackText: 'note', model: null, createdAt: '2026-01-01T00:00:00Z' }
      if (String(url).includes('/1')) return Response.json({ ...row, aiResponseText: 'exact\\nreply' })
      return Response.json({ items: [row], page: 0, size: 25, totalItems: 1, totalPages: 1 })
    }
    const i18n = createI18n({ legacy: false, locale: 'en', messages: { en: { ...messages.en, recon: { copy_footer: 'footer', copy: 'Copy', analysis_title_player: 'Review', collapse: 'Collapse' }, app: { close: 'Close' } } } })
    createApp({ render: () => h('div', [h(AnalysisResultPanel, { result: { analysis: 'review' } }), h(AdminAiReviewFeedbackPage)]) }).use(i18n).mount('#app')
  `)
  server = await createServer({ root, plugins: [plugin], server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' })
  await server.listen()
  const address = server.httpServer.address()
  chrome = await launchChromeForCdp(findChrome())
  const { client } = chrome
  client.on('Runtime.exceptionThrown', event => console.error('Browser exception:', event.exceptionDetails?.exception?.description || event.exceptionDetails?.text))
  client.on('Runtime.consoleAPICalled', event => { if (event.type === 'error') console.error('Browser console:', event.args.map(arg => arg.value || arg.description).join(' ')) })
  for (const width of [390, 1280]) {
    const { sessionId, targetId } = await chrome.openPage()
    await client.send('Runtime.enable', {}, sessionId)
    await client.send('Emulation.setDeviceMetricsOverride', { width, height: 850, deviceScaleFactor: 1, mobile: width < 600 }, sessionId)
    await client.send('Page.navigate', { url: `http://127.0.0.1:${address.port}/${name}.html` }, sessionId)
    let ready = false
    for (let attempt = 0; attempt < 100 && !ready; attempt++) {
      await delay(100)
      const result = await client.send('Runtime.evaluate', { expression: "!!document.querySelector('[data-test=feedback-btn]') && !!document.querySelector('.feedback-admin table')", returnByValue: true }, sessionId)
      ready = result.result.value === true
    }
    if (!ready) {
      const info = await client.send('Runtime.evaluate', { expression: 'JSON.stringify({url:location.href, state:document.readyState, body:document.body.outerHTML.slice(0,3000),requests:window.requests})', returnByValue: true }, sessionId)
      throw new Error(`fixture did not load at ${width}px: ${info.result.value}`)
    }
    const expression = `(async () => {
      const click = selector => { const node = document.querySelector(selector); if (!node) throw Error('missing ' + selector); node.click() }
      click('[data-test=copy-analysis-btn]'); await new Promise(r => setTimeout(r, 30)); click('[data-test=feedback-btn]'); await new Promise(r => setTimeout(r, 100))
      const dialog = document.querySelector('[role=dialog]'); if (!dialog) throw Error('dialog missing')
      const rect = dialog.getBoundingClientRect(); if (rect.left < -1 || rect.right > innerWidth + 1) throw Error('dialog overflows viewport')
      const choice = dialog.querySelector('[aria-pressed]'); choice.click(); await new Promise(r => setTimeout(r, 30))
      const submit = [...dialog.querySelectorAll('button')].find(x => x.textContent.trim() === 'Submit feedback'); if (!submit || submit.disabled) throw Error('submit unavailable'); submit.click()
      await new Promise(r => setTimeout(r, 150)); const sent = window.requests.find(x => x.options.method === 'POST')
      if (!sent || JSON.parse(sent.options.body).aiResponseText !== window.copied) throw Error('copy mismatch')
      click('[data-test=feedback-btn]'); await new Promise(r => setTimeout(r, 100))
      const form = document.querySelector('[role=dialog]'); const textarea = form.querySelector('textarea')
      textarea.value = 'preserve'; textarea.dispatchEvent(new Event('input', { bubbles: true })); await new Promise(r => setTimeout(r, 30))
      const retrySubmit = [...form.querySelectorAll('button')].find(x => x.textContent.trim() === 'Submit feedback')
      const count = window.requests.length; window.testOnline = false; retrySubmit.click(); await new Promise(r => setTimeout(r, 50))
      if (window.requests.length !== count || textarea.value !== 'preserve') throw Error('offline form was not preserved')
      window.testOnline = true; window.failNext = true; retrySubmit.click(); await new Promise(r => setTimeout(r, 150))
      if (textarea.value !== 'preserve' || !form.querySelector('[role=alert]')) throw Error('failed form was not preserved')
      form.querySelector('.dialog-close').click(); await new Promise(r => setTimeout(r, 100))
      const view = [...document.querySelectorAll('.feedback-admin button')].find(x => x.textContent.trim() === 'View'); view.click(); await new Promise(r => setTimeout(r, 150))
      if (![...document.querySelectorAll('pre')].some(x => x.textContent === 'exact\\nreply')) throw Error('detail mismatch')
      document.querySelector('[role=dialog] .dialog-close').click(); await new Promise(r => setTimeout(r, 100))
      const filter = document.querySelector('.feedback-admin select'); filter.value = 'OTHER'; filter.dispatchEvent(new Event('change', { bubbles: true })); await new Promise(r => setTimeout(r, 150))
      if (!window.requests.some(x => x.url.includes('reason=OTHER'))) throw Error('filter missing')
      const remove = [...document.querySelectorAll('.feedback-admin button')].find(x => x.textContent.trim() === 'Delete'); remove.click(); await new Promise(r => setTimeout(r, 100))
      const confirm = [...document.querySelectorAll('[role=dialog] button')].find(x => x.textContent.trim() === 'Delete'); if (!confirm) throw Error('delete confirmation missing'); confirm.click()
      await new Promise(r => setTimeout(r, 150)); if (!window.requests.some(x => x.options.method === 'DELETE')) throw Error('delete missing')
      return true
    })()`
    const outcome = await client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId)
    if (outcome.exceptionDetails || outcome.result.value !== true) throw new Error(JSON.stringify(outcome.exceptionDetails || outcome.result))
    console.log(`AI feedback browser flow OK (${width}px)`)
    await client.send('Target.closeTarget', { targetId })
  }
} finally {
  if (chrome) await chrome.close()
  if (server) await server.close()
  await rm(html, { force: true }); await rm(entry, { force: true })
}
