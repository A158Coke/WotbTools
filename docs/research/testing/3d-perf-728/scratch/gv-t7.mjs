import { Marionette } from './mn.mjs'
const m = new Marionette(); await m.connect(); await m.send('WebDriver:NewSession', { capabilities: {} })
console.log(JSON.stringify((await m.exec(`return {u:location.href, g:Object.keys(window).filter(k=>/perf|pb|__/i.test(k)).slice(0,30), scripts:Array.from(document.scripts).map(s=>s.src).slice(0,8)}`)).value))
m.close(); process.exit(0)
