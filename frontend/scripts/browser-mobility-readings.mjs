import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { findChrome, launchChromeForCdp } from './browser-chrome.mjs'
import { Page, delay } from './browser-page.mjs'
import { startFixtureServer } from './browser-fixtures/fixture-server.mjs'

const evidence = process.env.MOBILITY_EVIDENCE_DIR
const styles = ['tokens/scale', 'tokens/color', 'tokens', 'showcase', 'showcase-workspaces', 'showcase-pages',
  'showcase-rankings', 'showcase-cohesion', 'showcase-regressions', 'app-shell', 'playback-overlap-ux',
  'playback-shared', 'playback-mobile', 'playback-workspace']
const html = `<!doctype html><html lang="zh-CN"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="app"></div><script type="module">
import {createApp,h,ref,nextTick} from 'vue'
import {createI18n} from 'vue-i18n'
import MobilityChart from '/src/components/MobilityChart.vue'
import zh from '/src/locales/zh.json'
${styles.map(name => `import '/src/styles/${name}.css'`).join('\n')}
const chart=ref(null),cars=ref([]),loading=ref(false),mounted=ref(true)
const make=i=>({id:String(i),name:'测试车辆 '+i,color:'var(--color-info)',summary:'',carried:[],windows:[],
  phases:[{start:0,input:{mass:30,power:500+i*80,limit:i%2?65:25,permeability:{Firm:100,Medium:90,Soft:70}}}]})
createApp({setup:()=>()=>mounted.value?h(MobilityChart,{ref:chart,vehicles:cars.value,loading:loading.value,dataset:'fixture'}):null})
  .use(createI18n({legacy:false,locale:'zh',messages:{zh}})).mount('#app')
const frame=()=>new Promise(r=>requestAnimationFrame(r))
const range=()=>document.querySelector('.mob-reading-scrubber input')
window.mobilityTest={
  async setup(count,terrain='Firm',profile='summer'){
    document.documentElement.dataset.uiProfile=profile
    document.documentElement.dataset.theme=profile==='winter'?'light':'dark'
    cars.value=Array.from({length:count},(_,i)=>make(i));await nextTick()
    chart.value.restoreView({...chart.value.snapshotView(),terrain,hidden:[],isolated:'',zoom:[0,20],cursor:1.38})
    await nextTick();await frame()
  },
  async input(value){const el=range();el.value=String(value);el.dispatchEvent(new Event('input',{bubbles:true}));await frame();await nextTick();return this.measure()},
  measure(){const el=range(),r=el.getBoundingClientRect();return {value:Number(el.value),cursor:chart.value.snapshotView().cursor,left:r.x,width:r.width,top:r.y,height:r.height}},
  start(){window.trace=[];range().oninput=()=>{const el=range(),r=el.getBoundingClientRect(),at=performance.now();const row={value:Number(el.value),left:r.x,width:r.width};trace.push(row);requestAnimationFrame(async()=>{await nextTick();row.delay=performance.now()-at;row.cursor=chart.value.snapshotView().cursor})}},
  finish(){return {trace:window.trace,view:chart.value.snapshotView()}},
  async restore(value){chart.value.restoreView({...chart.value.snapshotView(),...value});await nextTick()},
  async load(value){loading.value=value;await nextTick()},
  async unmount(){mounted.value=false;await nextTick()}
}
await mobilityTest.setup(19)
window.ready=true
</script></body></html>`
const fixture = await startFixtureServer({ plugins: [{ name: 'mobility-readings-fixture', configureServer(server) {
  server.middlewares.use(async (request, response, next) => {
    if (request.url !== '/__mobility.html') return next()
    try { response.setHeader('Content-Type', 'text/html'); response.end(await server.transformIndexHtml(request.url, html)) }
    catch (error) { response.statusCode = 500; response.end(String(error)) }
  })
} }] })
let browser
const results = []
const recording = []
try {
  if (evidence) await mkdir(evidence, { recursive: true })
  browser = await launchChromeForCdp(findChrome())
  const version = await browser.client.send('Browser.getVersion')
  const { sessionId } = await browser.openPage()
  const page = new Page(browser.client, sessionId)
  const send = (method, params) => browser.client.send(method, params, sessionId)
  await page.enable()
  await page.emulate({ width: 1280, height: 900, touch: false, deviceScaleFactor: 1 })
  await page.goto(fixture.origin + '/__mobility.html')
  await page.waitFor(() => window.ready === true)
  const screenshot = async name => {
    if (!evidence) return
    const shot = await send('Page.captureScreenshot', { format: 'png' })
    await writeFile(resolve(evidence, name + '.png'), Buffer.from(shot.data, 'base64'))
  }
  const open = async () => { await page.tapSelector('.mob-readings-button', false); await page.animationsSettled() }
  const close = async () => { await page.tapSelector('[role=dialog]:last-of-type .dialog-close', false); await page.animationsSettled() }
  const key = (type, extra = {}) => send('Input.dispatchKeyEvent', { type, key: 'Alt', code: 'AltLeft', windowsVirtualKeyCode: 18, nativeVirtualKeyCode: 18, modifiers: type === 'keyUp' ? 0 : 1, ...extra })
  await open()
  for (const profile of ['summer', 'winter']) for (const width of [1280, 375]) {
    await page.emulate({ width, height: 900, touch: width < 768, deviceScaleFactor: 1 })
    await page.evaluate(`mobilityTest.setup(19,'Firm','${profile}')`)
    await page.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
    await page.animationsSettled()
    const geometry = []
    for (const value of [1.38, 1.4, 1.42, 1.98, 2, 2.02, 9.98, 10, 10.02]) geometry.push(await page.evaluate(`mobilityTest.input(${value})`))
    assert.ok(geometry.every(row => row.left === geometry[0].left && row.width === geometry[0].width), 'time text must not move the range: ' + JSON.stringify(geometry))
    assert.ok(geometry.every(row => row.cursor === row.value), 'range and shared time must match')
    await screenshot(`readings-${profile}-${width}`)
    results.push({ profile, width, geometry })
  }
  await page.emulate({ width: 1280, height: 900, touch: false, deviceScaleFactor: 1 })
  // 从 375px 回到 1280px 时 --sidebar-w 会过渡；等内容区稳定后再量 range 并派发原生拖拽。
  await page.animationsSettled()
  if (evidence) {
    browser.client.on('Page.screencastFrame', (params, session) => {
      if (session !== sessionId) return
      const index = recording.length
      recording.push({ file: `drag-${String(index).padStart(4, '0')}.jpg`, timestamp: params.metadata.timestamp,
        write: writeFile(resolve(evidence, `drag-${String(index).padStart(4, '0')}.jpg`), Buffer.from(params.data, 'base64')) })
      void send('Page.screencastFrameAck', { sessionId: params.sessionId })
    })
    await send('Page.startScreencast', { format: 'jpeg', quality: 65, maxWidth: 1280, maxHeight: 900, everyNthFrame: 1 })
  }
  for (const [count, terrain] of [[1, 'Firm'], [19, 'Firm'], [19, 'all'], [100, 'all']]) {
    await page.evaluate(`mobilityTest.setup(${count},'${terrain}')`)
    for (const interval of [8, 0]) for (const reverse of [false, true]) {
      await page.evaluate(`mobilityTest.input(${reverse ? 3 : 1.2})`)
      const geometry = await page.evaluate('mobilityTest.measure()')
      const start = geometry.left + 8 + (geometry.width - 16) * geometry.value / 20
      const y = geometry.top + geometry.height / 2
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: start, y })
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: start, y, button: 'left', buttons: 1, clickCount: 1 })
      await page.evaluate('mobilityTest.start()')
      for (let i = 1; i <= 80; i++) {
        await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: start + (reverse ? -1 : 1) * i * .35, y, buttons: 1 })
        if (interval) await delay(interval)
      }
      await delay(60)
      const stopped = await page.evaluate('mobilityTest.measure()')
      await delay(80)
      assert.equal((await page.evaluate('mobilityTest.measure()')).cursor, stopped.cursor, 'stopped pointer must not drift')
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: start + (reverse ? -28 : 28), y, button: 'left', buttons: 0, clickCount: 1 })
      await delay(40)
      const { trace, view } = await page.evaluate('mobilityTest.finish()')
      assert.ok(trace.length > 1, 'native input must actually move the thumb')
      assert.ok(trace.every((row, i) => !i || (reverse ? row.value <= trace[i - 1].value : row.value >= trace[i - 1].value)), 'unidirectional pointer must never reverse time')
      assert.equal(view.cursor, trace.at(-1).value, 'release must commit the last input')
      const speeds = await page.evaluate(`Array.from(document.querySelectorAll('.mob-reading-table tbody td:last-child'),el=>Number(el.textContent))`)
      assert.ok(speeds.every((speed, i) => !i || speed <= speeds[i - 1]), 'all visible readings must stay descending')
      results.push({ count, terrain, interval, reverse, trace, final: view.cursor })
    }
  }
  if (evidence) {
    await send('Page.stopScreencast', {})
    await Promise.all(recording.map(frame => frame.write))
    await writeFile(resolve(evidence, 'recording.json'), JSON.stringify(recording.map(({ file, timestamp }) => ({ file, timestamp })), null, 2))
  }
  await close()
  assert.equal(await page.evaluate(`Number(document.querySelector('.mob-plot input[type=range]').value)`), results.at(-1).final)
  await page.evaluate(`mobilityTest.setup(100,'all','summer')`)
  await page.evaluate('document.querySelector(".mob-area").scrollIntoView({block:"center"})')
  await page.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
  const svg = await page.evaluate(`(() => {const r=document.querySelector('.mob-area svg').getBoundingClientRect();return {x:r.x+r.width*.25,y:r.y+40}})()`)
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...svg })
  await delay(40)
  assert.equal(await page.evaluate(`document.querySelectorAll('.mob-tip > div').length`), 4)
  const before = await page.evaluate('document.querySelectorAll("polyline").length')
  await key('rawKeyDown')
  await page.waitFor(() => document.querySelector('.mob-tip')?.classList.contains('is-expanded'))
  assert.equal(await page.evaluate(`document.querySelectorAll('.mob-tip > div').length`), 300)
  const held = await page.evaluate('mobilityTest.finish().view.cursor')
  const tip = await page.evaluate(`(() => {const el=document.querySelector('.mob-tip'),r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,height:r.height,area:el.parentElement.clientHeight}})()`)
  assert.ok(tip.height < tip.area * .7, 'expanded tooltip height must be bounded')
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: tip.x, y: tip.y, modifiers: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: tip.x, y: tip.y, deltaY: 280, deltaX: 0, modifiers: 1 })
  await delay(120)
  assert.ok(await page.evaluate('document.querySelector(".mob-tip").scrollTop > 0'), 'expanded tooltip must receive native wheel scrolling')
  assert.equal(await page.evaluate('mobilityTest.finish().view.cursor'), held)
  assert.equal(await page.evaluate('document.querySelectorAll("polyline").length'), before)
  await screenshot('alt-expanded-summer')
  await key('keyUp')
  assert.equal(await page.evaluate('document.querySelectorAll(".mob-tip > div").length'), 4)
  await key('rawKeyDown')
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5, modifiers: 1 })
  await key('keyUp')
  assert.equal(await page.evaluate('Boolean(document.querySelector(".mob-tip.is-expanded"))'), false)
  await page.tapSelector('.mob-search input', false)
  await key('rawKeyDown')
  await key('keyUp')
  assert.equal(await page.evaluate('Boolean(document.querySelector(".mob-tip.is-expanded"))'), false)
  await page.emulate({ width: 375, height: 844, touch: true, deviceScaleFactor: 1 })
  await page.evaluate(`mobilityTest.setup(19,'all','winter')`)
  await page.tapSelector('.mob-readings-button', true)
  await page.animationsSettled()
  const touch = await page.evaluate('mobilityTest.measure()')
  const y = touch.top + touch.height / 2, x = touch.left + touch.width * .25
  await page.evaluate('mobilityTest.start()')
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] })
  for (let i = 1; i <= 10; i++) await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + i * 4, y, id: 1 }] })
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await delay(60)
  const touchResult = await page.evaluate('mobilityTest.finish()')
  assert.ok(touchResult.trace.length > 0, 'touch range must emit native input')
  assert.equal(touchResult.view.cursor, touchResult.trace.at(-1).value)
  results.push({ touch: true, ...touchResult })
  await screenshot('readings-touch-winter')
  await page.evaluate('mobilityTest.input(.1)')
  const earlyOrder = await page.evaluate(`Array.from(document.querySelectorAll('.mob-reading-table tbody th'),el=>el.textContent)`)
  await page.evaluate('mobilityTest.input(15)')
  const lateOrder = await page.evaluate(`Array.from(document.querySelectorAll('.mob-reading-table tbody th'),el=>el.textContent)`)
  assert.notDeepEqual(earlyOrder, lateOrder, 'readings must reorder after speed crossings')
  await page.evaluate(`mobilityTest.restore({terrain:'Firm',hidden:['0Firm'],isolated:'1Firm'})`)
  assert.equal(await page.evaluate('document.querySelectorAll(".mob-reading-table tbody tr").length'), 1)
  await page.evaluate(`(async()=>{await mobilityTest.load(true);await mobilityTest.restore({terrain:'all',hidden:[],isolated:'',zoom:null,cursor:180})})()`)
  assert.equal(await page.evaluate('mobilityTest.finish().view.cursor'), 180, 'loading must retain a restored time')
  await page.evaluate('mobilityTest.load(false)')
  assert.ok(await page.evaluate('mobilityTest.finish().view.cursor <= Number(document.querySelector(".mob-reading-scrubber input").max)'), 'completed range must clamp the shared time')
  await close()
  await page.tapSelector('.mob-tools .mob-action', true)
  await page.animationsSettled()
  assert.ok(await page.evaluate('Boolean(document.querySelector(".mob-expanded"))'), 'fullscreen chart must remain usable')
  await page.evaluate('mobilityTest.unmount()')
  assert.ok(page.consoleErrors.length === 0, page.consoleErrors.join('\n'))
  if (evidence) await writeFile(resolve(evidence, 'results.json'), JSON.stringify({ version, results }, null, 2))
  console.log('mobility readings: PASS geometry, 16 native drags, Alt/wheel, touch, shared time and fullscreen; ' + version.product)
} finally {
  await browser?.close()
  await fixture.server.close()
}
