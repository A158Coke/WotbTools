import { Marionette } from './mn.mjs'
const m = new Marionette(); await m.connect(); await m.send('WebDriver:NewSession', { capabilities: {} })
console.log(JSON.stringify(await m.exec(`return [location.href, !!document.querySelector('[data-testid=data-toolbar]'), document.querySelector('[data-testid=collection-trigger]')?.innerText, document.body.innerText.slice(0,200)]`)))
m.close()
