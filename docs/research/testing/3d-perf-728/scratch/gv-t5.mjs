import { openGv, sleep } from './gv-open.mjs'
const m = await openGv()
await m.exec(`document.querySelector('[data-test="replay3d-start"]').click()`)
for (let i = 0; i < 24; i++) { await sleep(10000); console.log(i*10, JSON.stringify((await m.exec(`return [typeof window.__pbPerf, document.querySelector('[data-testid=ws-3d]')?.innerText.slice(0,60).replace(/\n/g,' '), !!document.querySelector('input.pb-range')]`).catch(e=>({value:'ERR '+e.message.slice(0,80)}))).value)); }
m.close()
