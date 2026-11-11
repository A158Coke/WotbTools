import { Marionette } from './mn.mjs'
const m = new Marionette(); await m.connect(); await m.send('WebDriver:NewSession', { capabilities: {} })
console.log(JSON.stringify(await m.exec(`return [typeof window.__pbPerf, !!document.querySelector('[data-test="replay3d-start"]'), document.querySelector('[data-testid=ws-3d]')?.innerText.slice(0,200), !!document.querySelector('input.pb-range')]`)))
m.close()
