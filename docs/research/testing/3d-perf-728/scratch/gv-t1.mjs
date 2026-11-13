import { openGv, sleep } from './gv-open.mjs'
const m = await openGv()
console.log(JSON.stringify(await m.exec(`return [!!document.querySelector('[data-test="replay3d-start"]'), typeof window.__pbPerf, location.href, document.querySelector('[data-testid=ws-3d]')?.innerText.slice(0,120), document.querySelector('input.pb-range')?.max]`)))
m.close()
