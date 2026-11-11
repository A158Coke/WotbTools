import { Marionette } from './mn.mjs'
const m = new Marionette(); await m.connect(); await m.send('WebDriver:NewSession', { capabilities: {} })
await m.send('Marionette:SetContext', { value: 'chrome' })
const r = await m.exec(`
  const out = {}
  try { const gi = Cc["@mozilla.org/gfx/info;1"].getService(Ci.nsIGfxInfo); 
    for (const k of ['adapterDescription','adapterVendorID','adapterDeviceID','adapterDriver','adapterDriverVersion','windowProtocol','AzureCanvasBackend','AzureContentBackend','DWriteVersion','embeddedInFirefoxReality','isHeadless','ContentBackend']) { try { out[k] = String(gi[k]) } catch(e) { out[k]='ERR '+e.message } }
    const F = Ci.nsIGfxInfo; for (const f of ['FEATURE_WEBRENDER','FEATURE_WEBRENDER_SOFTWARE','FEATURE_WEBGL_OPENGL','FEATURE_WEBGL2','FEATURE_OPENGL_LAYERS','FEATURE_GL_SWIZZLE']) { try { out[f]=gi.getFeatureStatusStr ? gi.getFeatureStatusStr(F[f]) : gi.getFeatureStatus(F[f]) } catch(e){ out[f]='ERR '+e.message } }
    try { out.features = JSON.stringify(gi.getFeatures ? gi.getFeatures() : null).slice(0,1500) } catch(e) { out.features='ERR '+e.message }
  } catch (e) { out.err = String(e) }
  try { out.prefs = {} ; for (const p of ['gfx.webrender.all','gfx.webrender.software','webgl.disabled','webgl.force-enabled','gfx.canvas.accelerated','layers.acceleration.disabled','webgl.out-of-process','gfx.canvas.remote','gfx.webrender.compositor']) out.prefs[p]= Services.prefs.getPrefType(p) ? (Services.prefs.getPrefType(p)==128 ? Services.prefs.getBoolPref(p) : Services.prefs.getPrefType(p)==64 ? Services.prefs.getIntPref(p) : Services.prefs.getStringPref(p)) : 'unset' } catch(e) { out.prefs='ERR '+e.message }
  return out`)
console.log(JSON.stringify(r, null, 1)); m.close()
