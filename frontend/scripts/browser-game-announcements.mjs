import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { findChrome, launchChromeForCdp } from './browser-chrome.mjs'
import { Page } from './browser-page.mjs'
import { startFixtureServer } from './browser-fixtures/fixture-server.mjs'

// Production Vue, DOMPurify, router, wire validators and CSS; only external auth/HTTP are fixtures.
const source = { sourceKey: 'update', title: 'Official update — a long title with version information', sourceUrl: 'https://asia.wotblitz.com/en/news/updates/update/', language: 'en', publishedAtRaw: '2026-10-13T14:15:00', coverImageId: null, revision: 'source-revision', sync: { lastSuccessfulFetchAt: '2026-10-17T00:00:00Z', nextRefreshAt: '2026-10-17T12:00:00Z', stale: false },
  blocks: [{ id: 'heading', html: '<h3>Source heading</h3><script>window.__newsInjected=1</script>' },
    { id: 'list', html: '<ul><li>Original list item</li><li>Second original list item</li></ul>' },
    { id: 'table', html: '<table><tbody><tr><th scope="row">Original table header</th><td>Original table cell</td><td>Other cell</td></tr></tbody></table><p>m<sup>2</sup> H<sub>2</sub>O <del>old</del></p><a href="https://example.org" title="Source title">Safe link</a><img src="https://invalid.example/track"><a href="javascript:alert(1)">Unsafe link</a><iframe src="about:blank"></iframe>' }] }
let archive, submitted
const categories = [{ id: 1, name: '版本更新', type: 'GENERAL' }, { id: 2, name: 'Vehicles', type: 'SPECIALIZED' }]
function send(response, value, status = 200) { response.statusCode = status; response.setHeader('Content-Type','application/json'); response.end(value === undefined ? undefined : JSON.stringify(value)) }
async function payload(request) { let text = ''; for await (const chunk of request) text += chunk; return JSON.parse(text) }
const middleware = async (request, response, next) => {
  const url = new URL(request.url, 'http://fixture'), path = url.pathname
  if (path === '/api/observability/events') { send(response, undefined, 204); return }
  if (!/^\/api\/(admin\/)?news\//.test(path)) { next(); return }
  const managed = path.startsWith('/api/admin/')
  if (managed && request.headers.authorization !== 'Bearer fixture-access-token') { send(response, { errorCode:'AUTH_FORBIDDEN',status:403 },403);return }
  const tail = path.replace(/^\/api\/(admin\/)?news/, '')
  if (tail === '/sources') send(response,[{id:'WG',enabled:true},{id:'LESTA',enabled:false}])
  else if (tail === '/categories') send(response,categories)
  else if (tail === '/articles') send(response,{items:[{...source,blocks:[]}],page:1,size:20,totalItems:1,sync:source.sync})
  else if (tail === '/articles/update') send(response,source)
  else if (tail === '/archives' && request.method === 'POST') {
    submitted = await payload(request)
    const draft=submitted.archives[0]
    archive={id:7,source:'WG',version:draft.version,title:draft.title,status:'PUBLISHED',revision:0,categories:categories.filter(c=>draft.categoryIds.includes(c.id)),articles:[{...source,sync:null,blocks:source.blocks.filter(b=>draft.articles[0].blockIds.includes(b.id))}],createdAt:'2026-10-17T00:00:00Z',reviewedBy:'fixture-user',publishedAt:'2026-10-17T00:00:00Z',errorCode:null}
    send(response,{archiveIds:[7],deletedIds:[]},202)
  } else if (tail === '/archives') { const {articles,...summary}=archive||{};send(response,{items:archive?[summary]:[],page:1,size:20,totalItems:archive?1:0}) }
  else if (tail === '/archives/7' && request.method === 'DELETE') { assert.equal(archive.status,'WITHDRAWN');archive=null;send(response,undefined,204) }
  else if (tail === '/archives/7') send(response,archive)
  else if (['/archives/7/withdraw','/archives/7/restore'].includes(tail)) {
    const body=await payload(request);assert.equal(body.expectedRevision,archive.revision)
    archive={...archive,status:tail.endsWith('restore')?'PUBLISHED':'WITHDRAWN',revision:archive.revision+1};send(response,archive)
  }
  else send(response,{errorCode:'RESOURCE_NOT_FOUND',status:404},404)
}
const {server,origin}=await startFixtureServer({middleware})
const chrome=await launchChromeForCdp(findChrome())
const screenshots=process.env.NEWS_SCREENSHOTS
async function tap(page,selector,touch) {
  await page.waitForValue(`!!document.querySelector(${JSON.stringify(selector)})`,Boolean)
  const point=await page.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()`)
  await page.tap({...point,touch})
}
async function geometry(page) {
  const shape=await page.evaluate(`(()=>({overflow:document.documentElement.scrollWidth>innerWidth+1,small:matchMedia('(pointer:coarse)').matches?[...document.querySelectorAll('[data-testid="game-announcements-page"] button')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&r.height<43}).map(e=>e.textContent):[]}))()`)
  assert.equal(shape.overflow,false,'page overflow');assert.deepEqual(shape.small,[],'coarse-pointer controls are at least 44px tall')
}
let failed=0
try {
  for(const profile of ['showcase','classic']) for(const [name,width,height,touch] of [['desktop',1440,900,false],['tablet',1024,768,true],['mobile',390,844,true]]) {
    archive=null;submitted=null
    const {targetId,sessionId}=await chrome.openPage(),page=new Page(chrome.client,sessionId)
    try {
      await page.enable();await page.emulate({width,height,touch})
      await chrome.client.send('Page.addScriptToEvaluateOnNewDocument',{source:`localStorage.setItem('wotb-ui-profile',${JSON.stringify(profile)});localStorage.setItem('wotb-lang','en');`},sessionId)
      await page.goto(`${origin}/?view=game-announcements&ws-auth=1&ws-roles=news-admin`)
      await page.waitForValue('document.querySelectorAll(".news-card").length',n=>n===1)
      assert.equal(await page.evaluate('document.querySelector("[data-testid=news-lesta]").disabled'),true)
      await geometry(page)
      await tap(page,'.news-title-link',touch)
      await page.waitForValue('document.querySelector(".news-content h3")?.textContent',v=>v==='Source heading')
      const clean=await page.evaluate(`(()=>({injected:window.__newsInjected||0,scripts:document.querySelectorAll('.news-content script,.news-content iframe').length,images:document.querySelectorAll('.news-content img').length,links:[...document.querySelectorAll('.news-content a')].map(e=>e.getAttribute('href')),lists:document.querySelectorAll('.news-content ul li').length,cells:document.querySelectorAll('.news-content td').length,semantic:document.querySelectorAll('.news-content sup,.news-content sub,.news-content del').length,scope:document.querySelector('.news-content th').getAttribute('scope'),title:document.querySelector('.news-content a').title}))()`)
      assert.deepEqual(clean,{injected:0,scripts:0,images:0,links:['https://example.org',null],lists:2,cells:2,semantic:3,scope:'row',title:'Source title'},'real browser sanitizer and source block integrity')
      await geometry(page)
      if(screenshots){await mkdir(screenshots,{recursive:true});const shot=await chrome.client.send('Page.captureScreenshot',{format:'png'},sessionId);await writeFile(join(screenshots,`${profile}-${name}.png`),Buffer.from(shot.data,'base64'))}
      await page.evaluate('history.back()');await page.waitForValue('document.querySelectorAll(".news-card").length',n=>n===1)
      await tap(page,'.news-card .app-button',touch)
      await page.waitForValue('!document.querySelector("[data-testid=news-open-editor]").disabled',Boolean)
      await tap(page,'[data-testid=news-open-editor]',touch)
      await page.waitForValue('!!document.querySelector("[data-testid=news-merge-version]")',Boolean)
      await page.evaluate(`(()=>{const e=document.querySelector('[data-testid=news-merge-version]');e.value='11.21';e.dispatchEvent(new Event('input',{bubbles:true}))})()`)
      await tap(page,'[data-testid=news-block-0-0]',touch)
      await page.evaluate(`(()=>{const b=[...document.querySelectorAll('.news-editor button')].find(e=>e.textContent==='View final preview');b.dataset.testid='news-preview-button'})()`)
      await tap(page,'[data-testid=news-preview-button]',touch)
      await page.waitForValue('!!document.querySelector("[data-testid=news-final-preview]")',Boolean)
      assert.equal(await page.evaluate('document.querySelector("[data-testid=news-final-preview]").textContent.includes("Source heading")'),false)
      await tap(page,'[data-testid=news-submit]',touch)
      await page.waitForValue('!!document.querySelector("[data-testid=news-archive-detail]")',Boolean)
      assert.deepEqual(submitted.archives[0].articles[0],{sourceKey:'update',revision:'source-revision',blockIds:['list','table']})
      assert.equal(await page.evaluate('document.querySelector("[data-testid=news-archive-detail]").textContent.includes("Source heading")'),false)
      await geometry(page)
      await page.evaluate('window.__wsAuth.tokenParsed.value={realm_access:{roles:[]}}')
      await page.waitForValue('!document.querySelector("[data-testid=news-archive-detail]")',Boolean)
      await page.evaluate('window.__wsAuth.tokenParsed.value={realm_access:{roles:["news-admin"]}}')
      await page.waitForValue('!!document.querySelector("[data-testid=news-archive-detail]")',Boolean)
      for(const [label,status] of [['Withdraw','WITHDRAWN'],['Restore publication','PUBLISHED'],['Withdraw','WITHDRAWN'],['Delete permanently',null]]) {
        await page.evaluate(`(()=>{const e=[...document.querySelectorAll('[data-testid=news-archive-detail] button')].find(e=>e.textContent===${JSON.stringify(label)});if(!e)throw new Error('missing action');e.dataset.testid='news-lifecycle-action'})()`)
        await tap(page,'[data-testid=news-lifecycle-action]',touch)
        await tap(page,'[data-testid=confirm-ok]',touch)
        await page.waitForValue(status ? `document.querySelector('[data-testid=news-archive-detail]')?.textContent.includes(${JSON.stringify(status==='PUBLISHED'?'Published':'Withdrawn')}) && !document.querySelector('[data-testid=confirm-ok]')` : `!document.querySelector('[data-testid=news-archive-detail]') && !document.querySelector('[data-testid=confirm-ok]')`,Boolean)
        assert.equal(archive?.status??null,status)
      }
      assert.deepEqual(page.consoleErrors,[],'no uncaught errors')
      console.log(`PASS ${profile}-${name}: real sanitizer, block review, save/withdraw/restore/delete, role loss, geometry`)
    } catch(error) { failed++;console.error(`FAIL ${profile}-${name}: ${error.stack}`) }
    finally {await chrome.client.send('Target.closeTarget',{targetId})}
  }
} finally {await chrome.close();await server.close()}
if(failed)process.exitCode=1
