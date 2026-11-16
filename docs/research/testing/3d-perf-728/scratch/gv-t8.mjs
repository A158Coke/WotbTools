import { Marionette } from './mn.mjs'
const m = new Marionette(); await m.connect(); await m.send('WebDriver:NewSession', { capabilities: {} })
await m.send('Marionette:SetContext', { value: 'chrome' })
console.log(JSON.stringify((await m.exec(`return Services.dirsvc.get('ProfD', Ci.nsIFile).path`)).value))
await m.exec(`Services.profiler.StartProfiler(1048576, 1, ["js"], ["GeckoMain"], 0); return 1`)
await new Promise(r=>setTimeout(r,2000))
console.log(JSON.stringify(await m.execAsync(`const done=arguments[arguments.length-1]; const p=Services.dirsvc.get('ProfD', Ci.nsIFile).path+'/t8.json'; Services.profiler.dumpProfileToFileAsync(p).then(()=>done('ok '+p)).catch(e=>done('ERR '+e))`)))
await m.exec(`Services.profiler.StopProfiler(); return 1`)
m.close(); process.exit(0)
