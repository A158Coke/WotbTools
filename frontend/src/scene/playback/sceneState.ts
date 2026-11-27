import { confirm as appConfirm } from '../../composables/useConfirm.js'
import { createVehicleLife } from './vehicleLife.ts'
import { spansContainAt } from '../trackInterp.js'
import { makeReplacedAt } from './identity.ts'
import { GRID_DT } from './util.js'
import { QUALITY_PRESETS, shadowQualityEligible } from './quality.js'
import { boolPref, persistBoolPref, resolveQualityKey } from './preferences.ts'
import { buildRenderSettingsReloadUrl, type RenderSettingsPatch } from './renderSettings.ts'
import { createContactShadowControl } from './contactShadowControl.ts'
import type { Host } from '../playbackScene.js'
import { bind } from '../hostBind.ts'

export function installSceneState(S: Host, contactShadowOverride?: boolean) {
  Object.assign(S, {
    setQuality: bind(S, setQuality),
    applyRenderSettings: bind(S, applyRenderSettings),
    applyGlbGate: bind(S, applyGlbGate),
    idxOf: bind(S, idxOf),
    hpAt: bind(S, hpAt),
    visibleAt: bind(S, visibleAt),
  })

  S.DATA = null;
  S.VIS_BY_EID = new Map();
  S.POSE_GRID = { tStart: 0, samples: 0 };
  S.T = 0;
  S.PLAYING = false;
  S.SPEED = S.store.speed;
  S.START = 0;
  S.END = 0;
  S.sceneClock = null;
  S.canonicalClock = null;
  S.renderer = null;
  S.scene = undefined;
  S.camera = undefined;
  S.controls = undefined;
  S.clock = undefined;
  S.raycaster = undefined;
  S.hemiLight = null;
  S.sunLight = null;
  S.sizeObserver = null;
  S.destroyed = false;
  S.MAP_BASES_KIND = null;
  S.MAP_SPAWN_POINTS = null;
  S.rafId = 0;
  S.paused = false;
  S.DEBUG = (() => { try { return new URLSearchParams(location.search).has('debug'); } catch (e) { return false; } })();
  S.PICK_DEBUG = (() => {
    if (!import.meta.env.DEV) return false;
    try {
      const q = new URLSearchParams(location.search);
      return q.has('admin') || q.has('debug');
    } catch (e) { return false; }
  })();
  S.LOGDEPTH = boolPref('pb_logdepth', 'logdepth', false);
  S.DYNRES = boolPref('pb_dynres', 'dynres', true);
  S.ARMOR_HIGHLIGHT = boolPref('pb_armor_highlight', 'armorhl', false);
  S.CONTACT_SHADOWS_PREF = contactShadowOverride !== undefined
    ? !!contactShadowOverride
    : boolPref('pb_contact_shadows', 'contactshadows', false);

  S.QKEY = resolveQualityKey();
  S.Q = QUALITY_PRESETS[S.QKEY as keyof typeof QUALITY_PRESETS];
  S.store.qualityKey = S.QKEY;
  S.store.qualityLabel = '画质 · ' + S.Q.label;
  S.store.logdepth = S.LOGDEPTH;
  S.store.dynres = S.DYNRES;
  S.store.armorHighlight = S.ARMOR_HIGHLIGHT;
  S.store.contactShadowsPref = S.CONTACT_SHADOWS_PREF;

  S.contactShadowCtl = createContactShadowControl({
    store: S.store, qualityKey: () => S.QKEY, getScene: () => S.scene, getSunLight: () => S.sunLight,
    surfaceHeightAt: (x, z) => S.mapWorld.annotationSurfaceHeightAt(x, z), stencilAssembled: () => !!S.rendererCaps?.stencil,
  });
  S.contactShadowCtl.setEnabled(S.CONTACT_SHADOWS_PREF);
  S.applyQualityFeatures = () => {};
  S.requestWaterReflectionRefresh = () => {};
  function setQuality(S: Host, k: keyof typeof QUALITY_PRESETS) {
    if (!QUALITY_PRESETS[k] || k === S.QKEY) return;
    const apply = () => {
      if (S.perf) S.perf.interrupt('quality-change');
      S.QKEY = k; S.Q = QUALITY_PRESETS[k];
      try { localStorage.setItem('pb_quality', k); } catch (e) {}
      S.store.qualityKey = S.QKEY;
      S.store.qualityLabel = '画质 · ' + S.Q.label;
      if (!shadowQualityEligible(k)) S.contactShadowCtl.setEnabled(false);
      else S.contactShadowCtl.setEnabled(!!S.CONTACT_SHADOWS_PREF);
      S.applyQualityFeatures();
      S.applyGlbGate();
    };
    if (S.DATA) {
      const reload = async () => {

        try { await S.stageReloadReplay?.(!!S.CONTACT_SHADOWS_PREF); } catch (e) { return; }
        if (S.perf) S.perf.interrupt('quality-change');
        try { localStorage.setItem('pb_quality', k); } catch (e) {}
        location.replace(buildRenderSettingsReloadUrl(location.href, {
          qualityKey: k, armorHighlight: S.ARMOR_HIGHLIGHT,
        }));
      };
      if (window.__TAURI__) { void reload(); return; }
      appConfirm({
        title: '切换画质',
        message: '切换到「' + QUALITY_PRESETS[k].label + '」画质将重新加载回放，继续？',
      }).then((ok) => { if (ok) void reload(); });
      return;
    }
    apply();
  }
  async function applyRenderSettings(S: Host, patch: RenderSettingsPatch): Promise<boolean> {
    const quality = patch.qualityKey;
    const qualityChanged = quality !== undefined && !!QUALITY_PRESETS[quality] && quality !== S.QKEY;
    const logdepthChanged = patch.logdepth !== undefined && !!patch.logdepth !== S.LOGDEPTH;
    const dynresChanged = patch.dynres !== undefined && !!patch.dynres !== S.DYNRES;
    const nextQuality = qualityChanged && quality ? quality : S.QKEY;
    const nextContactPref = patch.contactShadows !== undefined
      ? !!patch.contactShadows
      : !!S.CONTACT_SHADOWS_PREF;
    const contactPrefChanged = patch.contactShadows !== undefined
      && nextContactPref !== !!S.CONTACT_SHADOWS_PREF;
    const contactTarget = nextContactPref && shadowQualityEligible(nextQuality);
    const contactShadowsChanged = contactTarget !== S.store.contactShadows;
    const needsReload = qualityChanged || logdepthChanged || dynresChanged || contactShadowsChanged;
    if (!needsReload && !contactPrefChanged) return false;
    if (S.DATA && needsReload) {
      try { await S.stageReloadReplay?.(nextContactPref); } catch (e) { return false; }
    }
    if (contactPrefChanged) {
      S.CONTACT_SHADOWS_PREF = nextContactPref;
      S.store.contactShadowsPref = nextContactPref;
      persistBoolPref('pb_contact_shadows', nextContactPref);
      try {
        const url = new URL(location.href);
        if (url.searchParams.has('contactshadows')) {
          url.searchParams.delete('contactshadows');
          window.history.replaceState(window.history.state, '', url);
        }
      } catch (e) {}
    }
    if (logdepthChanged) {
      S.LOGDEPTH = !!patch.logdepth;
      persistBoolPref('pb_logdepth', !!patch.logdepth);
      S.store.logdepth = !!patch.logdepth;
    }
    if (dynresChanged) {
      S.DYNRES = !!patch.dynres;
      persistBoolPref('pb_dynres', !!patch.dynres);
      S.store.dynres = !!patch.dynres;
    }
    if (!S.DATA) {
      if (qualityChanged && quality) setQuality(S, quality);
      if (contactTarget !== S.store.contactShadows) S.contactShadowCtl.setEnabled(contactTarget);
      return false;
    }
    if (!needsReload) return false;
    if (S.perf) S.perf.interrupt('render-settings-change');
    const patchForUrl: RenderSettingsPatch = {};
    if (contactPrefChanged) patchForUrl.contactShadows = nextContactPref;
    if (qualityChanged && quality) {
      S.QKEY = quality;
      S.Q = QUALITY_PRESETS[quality];
      try { localStorage.setItem('pb_quality', quality); } catch (e) {}
      S.store.qualityKey = quality;
      S.store.qualityLabel = '画质 · ' + S.Q.label;
      if (!shadowQualityEligible(quality)) S.contactShadowCtl.setEnabled(false);
      patchForUrl.qualityKey = quality;
    }
    if (contactTarget !== S.store.contactShadows) S.contactShadowCtl.setEnabled(contactTarget);
    if (logdepthChanged) patchForUrl.logdepth = !!patch.logdepth;
    if (dynresChanged) patchForUrl.dynres = !!patch.dynres;
    patchForUrl.armorHighlight = !!S.ARMOR_HIGHLIGHT;
    location.replace(buildRenderSettingsReloadUrl(location.href, patchForUrl));
    return true;
  }
  function applyGlbGate(S: Host) {
    S.store.glbAllowed = S.Q.allowGlb && !S.Q.forceGlb;
    S.store.treadAllowed = !!S.Q.treadMarks;
    if (S.Q.forceGlb) {
      S.store.glbOn = true;
      if (!S.vehicles.glbOn()) S.vehicles.applyGlbToggle(true);
    } else if (!S.Q.allowGlb) {
      S.store.glbOn = false;
      if (S.vehicles.glbOn()) S.vehicles.applyGlbToggle(false);
    }
  }


  function idxOf(S: Host, t: number) { return Math.floor((t - S.DATA.meta.t_start) / GRID_DT); }


  function hpAt(_S: Host, v: { def: { hp: ReadonlyArray<readonly [number, number]>; max_hp: number } }, t: number) {
    const hp = v.def.hp; let cur = v.def.max_hp;
    for (const [ht, hv] of hp) { if (ht <= t) cur = hv; else break; }
    return cur;
  }
  S.vehicleLife = createVehicleLife({ getCanonical: () => S.store.playbackSession?.canonical, getVehicles: () => S.vehicles.getVehicles() });
  S.sceneLifeAt = S.vehicleLife.sceneLifeAt;
  S.deathAt = S.vehicleLife.deathAt;
  S.deathTimesOf = S.vehicleLife.deathTimesOf;
  S.replacedAt = makeReplacedAt({
    canonical: () => S.store.playbackSession?.canonical,
    vehicles: () => S.vehicles.getVehicles().map((v: { def: { eid: unknown; account_id: unknown; coverage: unknown } }) => ({ eid: v.def.eid, account_id: v.def.account_id, coverage: v.def.coverage })),
    spansOf: (id) => S.VIS_BY_EID.get(id),
  });
  function visibleAt(S: Host, v: { def: { eid: unknown; coverage: unknown } }, t: number) {
    return spansContainAt(S.VIS_BY_EID.get(v.def.eid) ?? v.def.coverage, t);
  }
}
