import { Marionette } from './mn.mjs'
const m = new Marionette(); console.log(await m.connect())
console.log(JSON.stringify(await m.send('WebDriver:NewSession', { capabilities: {} })).slice(0, 300))
console.log(await m.send('WebDriver:GetCurrentURL'))
console.log(JSON.stringify(await m.exec(`const c=document.createElement('canvas');const g=c.getContext('webgl2');const e=g.getExtension('WEBGL_debug_renderer_info');return [navigator.userAgent, g.getParameter(g.RENDERER), e&&g.getParameter(e.UNMASKED_RENDERER_WEBGL), e&&g.getParameter(e.UNMASKED_VENDOR_WEBGL), innerWidth, innerHeight, devicePixelRatio, navigator.hardwareConcurrency]`)))
m.close()
