import { Marionette } from './mn.mjs'
const m = new Marionette(); await m.connect(); await m.send('WebDriver:NewSession', { capabilities: {} })
console.log(JSON.stringify(await m.execAsync(`const done=arguments[arguments.length-1]; const t=performance.now(); Promise.all(['/agent-assets/index.json','/agent-assets/'].map(u=>fetch(u).then(r=>[u,r.status,r.headers.get('content-length')]).catch(e=>[u,'ERR '+e]))).then(r=>done([r, performance.now()-t]))`)))
m.close()
