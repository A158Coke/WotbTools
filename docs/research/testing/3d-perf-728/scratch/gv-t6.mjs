import { Marionette } from './mn.mjs'
const m = new Marionette(); await m.connect(); await m.send('WebDriver:NewSession', { capabilities: {} })
await m.exec(`document.querySelector('[data-test="pb-secondary-entry"]').click()`); await new Promise(r=>setTimeout(r,1000))
console.log(JSON.stringify((await m.exec(`return Array.from(document.querySelectorAll('button, [role=tab], [role=radio], .segmented-option')).filter(e=>!/pb-roster-row/.test(e.className)).map(e=>[e.className.slice(0,24), e.dataset.test||e.dataset.testid||'', (e.title||e.getAttribute('aria-label')||e.textContent.trim()).slice(0,14)].join('|')).slice(0,60)`)).value))
m.close()
