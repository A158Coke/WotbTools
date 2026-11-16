import { Marionette } from './mn.mjs'
export const sleep = (ms) => new Promise(r => setTimeout(r, ms))
export async function openGv({ fixture = 'random-battle-example.wotbreplay', query = '&q=mid&dynres=0&armorhl=0' } = {}) {
  const m = new Marionette(); await m.connect(); await m.send('WebDriver:NewSession', { capabilities: {} })
  await m.send('WebDriver:Navigate', { url: `http://127.0.0.1:21653/?view=replay&perf${query}` })
  await sleep(4000)
  for (let i = 0; i < 40; i++) { if (await m.exec(`return !!document.querySelector('[data-testid="select-files-input"]')`).then(r => r.value)) break; await sleep(500) }
  console.log('example click', JSON.stringify(await m.exec(`const b=Array.from(document.querySelectorAll('button')).find(x=>x.textContent.includes('打开示例回放')); if(!b) return 'nobtn'; b.click(); return 'clicked'`)))
  for (let i = 0; i < 120; i++) { if (await m.exec(`return !!document.querySelector('[data-testid="data-toolbar"]')`).then(r => r.value)) break; await sleep(1000) }
  await m.exec(`document.querySelector('[data-testid="ws-tab"][data-cap="3d"]').click()`)
  for (let i = 0; i < 60; i++) { if (await m.exec(`return !!document.querySelector('[data-test="replay3d-start"]')`).then(r => r.value)) break; await sleep(500) }
  return m
}
