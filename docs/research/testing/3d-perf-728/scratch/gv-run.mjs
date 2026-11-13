// GeckoView（模拟器）采集：gv-run.mjs <top|follow|rec|scan> [--profile] [--secs=30] [--t0=60] [--armorhl=0]
import { writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { openGv, sleep } from './gv-open.mjs'
const args = process.argv.slice(2); const sc = args[0]
const flag = (n, d) => (args.find(a => a.startsWith(`--${n}=`)) || '').split('=')[1] ?? d
const SECS = Number(flag('secs', 30)), PROFILE = args.includes('--profile'), T0 = Number(flag('t0', 60)), AH = flag('armorhl', '0'), RATE = flag('tag', '')
const ADB = process.env.LOCALAPPDATA + '/Android/Sdk/platform-tools/adb.exe'
const m = await openGv({ query: `&q=mid&dynres=0&armorhl=${AH}` })
await m.exec(`document.querySelector('[data-test="replay3d-start"]').click()`)
for (let i = 0; i < 300; i++) { const r = await m.exec(`return !!window.wrappedJSObject.__pbPerf && window.wrappedJSObject.__pbPerf.snapshot().sessionFrames > 30`).catch(() => ({ value: false })); if (r.value) break; await sleep(1000) }
await sleep(5000)
const camClick = async (t) => { await m.exec(`document.querySelector('[data-test="pb-secondary-entry"]').click()`); await sleep(800); const r = await m.exec(`const b=Array.from(document.querySelectorAll('.segmented-option')).find(b=>!b.dataset.testid && b.textContent.includes(${JSON.stringify(t)})); if(!b) return 'none'; b.click(); return 'ok'`); await sleep(400); await m.exec(`document.querySelector('[data-testid="display-close"]')?.click(); return 1`); return r.value }
const seek = (s) => m.exec(`const r=document.querySelector('input.pb-range'); const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; set.call(r, ${s}); r.dispatchEvent(new Event('input',{bubbles:true})); r.dispatchEvent(new Event('change',{bubbles:true})); return r.value`)
const rng = (await m.exec(`const r=document.querySelector('input.pb-range'); return [Number(r.min), Number(r.max)]`)).value
console.log('range', rng)
if (sc === 'scan') {
  console.log('cam', await camClick('录像者')); await sleep(1500)
  const out = []
  for (let t = rng[0]; t < rng[1]; t += 3) { await seek(t); await sleep(500); out.push(Math.round(t) + ':' + (await m.exec(`const c=document.querySelector('.reticle-halo'); return c?Math.round(Number(c.getAttribute('r'))):-1`)).value) }
  console.log(out.join(' ')); m.close(); process.exit(0)
}
if (sc === 'follow') await m.exec(`document.querySelector('.pb-roster-row').click()`)
else console.log('cam', await camClick(sc === 'rec' ? '录像者' : '固定'))
await sleep(1500); await seek(T0); await sleep(8000)
await m.exec(`window.__raf={ts:[]}; const f=(t)=>{window.__raf.ts.push(t); window.__raf.id=requestAnimationFrame(f)}; window.__raf.id=requestAnimationFrame(f); return 1`)
if (PROFILE) {
  await m.send('Marionette:SetContext', { value: 'chrome' })
  await m.exec(`Services.profiler.StartProfiler(8388608, 1, ["js"], ["GeckoMain","Compositor","Renderer","CanvasRenderer","DOM Worker"], 0); return 1`)
  await m.send('Marionette:SetContext', { value: 'content' })
}
await m.exec(`const P=window.wrappedJSObject.__pbPerf; P.reset(); P.startCapture(JSON.parse(JSON.stringify({scenarioId:${JSON.stringify('gv-' + sc)}, durationMs:60000}))); return 1`)
await sleep(SECS * 1000)
const cap = (await m.exec(`return JSON.parse(JSON.stringify(window.wrappedJSObject.__pbPerf.stopCapture()))`)).value
const snap = (await m.exec(`const s=JSON.parse(JSON.stringify(window.wrappedJSObject.__pbPerf.snapshot())); return {identity:s.identity, resources:s.resources, gpu:s.gpu, annotation:s.annotation, events:s.events}`)).value
const raf = (await m.exec(`cancelAnimationFrame(window.__raf.id); return window.__raf.ts`)).value
const gl = (await m.exec(`const c=document.createElement('canvas');const g=c.getContext('webgl2');const e=g.getExtension('WEBGL_debug_renderer_info');return [g.getParameter(g.RENDERER), e&&g.getParameter(e.UNMASKED_RENDERER_WEBGL), innerWidth, innerHeight, devicePixelRatio]`)).value
const name = `gv_${sc}_${PROFILE ? 'prof' : 'plain'}${RATE}`
let profFile = null
if (PROFILE) {
  await m.send('Marionette:SetContext', { value: 'chrome' })
  await m.execAsync(`const done=arguments[arguments.length-1]; Services.profiler.dumpProfileToFileAsync(Services.dirsvc.get('ProfD', Ci.nsIFile).path+'/${name}.json').then(()=>done('ok')).catch(e=>done('ERR '+e))`)
  await m.exec(`Services.profiler.StopProfiler(); return 1`)
  await m.send('Marionette:SetContext', { value: 'content' })
  writeFileSync(`out/${name}.profile.json`, execSync(`"${ADB}" exec-out run-as com.wotbtools.app cat files/mozilla/42m23wtf.default/${name}.json`, { env: { ...process.env, MSYS_NO_PATHCONV: '1' }, maxBuffer: 1<<30 })); profFile = `out/${name}.profile.json`
}
const iv = raf.slice(1).map((t, i) => t - raf[i])
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))] }
const cut = raf[0] + SECS * 1000 - 100; const ts = raf.filter(t => t <= cut); const iv2 = ts.slice(1).map((t, i) => t - ts[i])
const stat = { n: iv2.length, p50: pct(iv2, .5), p95: pct(iv2, .95), p99: pct(iv2, .99), max: Math.max(...iv2), gt33: iv2.filter(x => x > 33.4).length, gt50: iv2.filter(x => x > 50).length, gt100: iv2.filter(x => x > 100).length, gt200: iv2.filter(x => x > 200).length, gt400: iv2.filter(x => x > 400).length }
const fr = cap.frames
const frameStat = { n: fr.length, rebuilds: fr.length ? fr[fr.length - 1].terrainRebuilds - fr[0].terrainRebuilds : null, cpu_p50: pct(fr.map(f => f.cpuFrameMs), .5), cpu_p95: pct(fr.map(f => f.cpuFrameMs), .95), cpu_max: Math.max(...fr.map(f => f.cpuFrameMs)), dpr: [Math.min(...fr.map(f => f.dpr)), Math.max(...fr.map(f => f.dpr))], tRange: [fr[0]?.t, fr[fr.length - 1]?.t], gpuMainP50: pct(fr.map(f => f.gpu_main_ms).filter(x => x != null), .5) }
const keep = ['t', 'at', 'frameIntervalMs', 'cpuFrameMs', 'tickMs', 'updateMs', 'cameraMs', 'terrainCheckInclusiveMs', 'renderMs', 'armorMs', 'terrainRebuilds', 'dpr', 'gpu_main_ms', 'veh']
writeFileSync(`out/${name}.json`, JSON.stringify({ name, sc, secs: SECS, t0: T0, stat, frameStat, captureStats: cap.statistics, events: cap.events, identity: snap.identity, resources: snap.resources, gl, raf, frames: fr.map(f => Object.fromEntries(keep.map(k => [k, f[k]]))), profFile }))
console.log(name, JSON.stringify(stat), JSON.stringify(frameStat), JSON.stringify(gl), 'cam', snap.identity.cameraMode, 'q', snap.identity.quality, 'dpr', snap.identity.dpr, 'viewport', snap.identity.viewport)
m.close()
