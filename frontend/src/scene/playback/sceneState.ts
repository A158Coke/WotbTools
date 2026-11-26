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

export function installSceneState(S: Host) {
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

  S.QKEY = resolveQualityKey();
  S.Q = QUALITY_PRESETS[S.QKEY as keyof typeof QUALITY_PRESETS];
  S.store.qualityKey = S.QKEY;
  S.store.qualityLabel = '画质 · ' + S.Q.label;
  S.store.logdepth = S.LOGDEPTH;
  S.store.dynres = S.DYNRES;
  S.store.armorHighlight = S.ARMOR_HIGHLIGHT;
  S.contactShadowCtl = createContactShadowControl({
    store: S.store, qualityKey: () => S.QKEY, getScene: () => S.scene, getSunLight: () => S.sunLight,
    surfaceHeightAt: (x, z) => S.mapWorld.annotationSurfaceHeightAt(x, z), stencilAssembled: () => !!S.rendererCaps?.stencil,
  });
  S.contactShadowCtl.setEnabled(boolPref('pb_contact_shadows', 'shadows', false));
  // 装配段替换（建场景后才有反射句柄）；dirty frame 强制刷新反射（按需渲染只有一帧）。
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
      S.applyQualityFeatures();
      S.applyGlbGate();
    };
    if (S.DATA) {
      const reload = async () => {
        try { await S.stageReloadReplay?.(); } catch (e) { return; }
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
  /**
   * 统一应用「重建渲染上下文」类设置（画质 / Log Depth / 动态分辨率 / 接地阴影）。
   * 设置面板 Save 一次可能改多项：这里只发**一次**整页重载，不弹二次确认
   * （Save 本身已是显式动作，面板内的 reload 说明在提交前已告知）。
   * 未开播时渲染器尚未创建，就地记偏好即可，下次 initScene 按新偏好装配。
   * live 项（装甲高亮 / 炮声）不经过本函数。
   * @returns 是否触发了整页重载
   */
  async function applyRenderSettings(S: Host, patch: RenderSettingsPatch): Promise<boolean> {
    const quality = patch.qualityKey;
    const qualityChanged = quality !== undefined && !!QUALITY_PRESETS[quality] && quality !== S.QKEY;
    const logdepthChanged = patch.logdepth !== undefined && !!patch.logdepth !== S.LOGDEPTH;
    const dynresChanged = patch.dynres !== undefined && !!patch.dynres !== S.DYNRES;
    // 接地阴影受画质门禁约束；一次 Save 同时改画质时按新档位算有效目标。
    // 没有显式 patch 时沿用当前选择：任何一次重载都必须把它写进 URL，否则
    // 待开播卡片开过阴影（URL 无 ?shadows）后改画质重载会静默丢选择，
    // 或降档后遗留 ?shadows=1 让下次升档意外恢复。
    const nextQuality = qualityChanged && quality ? quality : S.QKEY;
    const contactDesired = patch.contactShadows !== undefined ? !!patch.contactShadows : S.store.contactShadows;
    const contactTarget = contactDesired && shadowQualityEligible(nextQuality);
    const contactShadowsChanged = patch.contactShadows !== undefined && contactTarget !== S.store.contactShadows;
    if (!qualityChanged && !logdepthChanged && !dynresChanged && !contactShadowsChanged) return false;
    // 已开播：整页重载前先把当前回放暂存到 IndexedDB（重载后由工作台恢复）；
    // 暂存失败就中止本次应用，保留当前会话，绝不带着回放丢失风险重载。
    if (S.DATA) {
      try { await S.stageReloadReplay?.(); } catch (e) { return false; }
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
      // 未开播：画质沿用既有 apply 链（含 GLB / 履带门禁），不重载。
      if (qualityChanged && quality) setQuality(S, quality);
      if (contactTarget !== S.store.contactShadows) S.contactShadowCtl.setEnabled(contactTarget);
      return false;
    }
    if (S.perf) S.perf.interrupt('render-settings-change');
    const patchForUrl: RenderSettingsPatch = {};
    if (qualityChanged && quality) {
      S.QKEY = quality;
      S.Q = QUALITY_PRESETS[quality];
      try { localStorage.setItem('pb_quality', quality); } catch (e) {}
      S.store.qualityKey = quality;
      S.store.qualityLabel = '画质 · ' + S.Q.label;
      if (!shadowQualityEligible(quality)) S.contactShadowCtl.setEnabled(false);   // 降档清零，与 setQuality 同语义
      patchForUrl.qualityKey = quality;
    }
    // 只有真的变化的偏好进 URL；URL 未显式携带的 logdepth/dynres 仍由 localStorage 承载。
    if (logdepthChanged) patchForUrl.logdepth = !!patch.logdepth;
    if (dynresChanged) patchForUrl.dynres = !!patch.dynres;
    // 接地阴影没有 localStorage 载体：既然本次重载，就把有效目标显式带过去。
    patchForUrl.contactShadows = contactTarget;
    // 装甲高亮是 live 项：重载前把刚写入的当前值带进 URL（仅当 URL 原本已有 ?armorhl=）。
    patchForUrl.armorHighlight = !!S.ARMOR_HIGHLIGHT;
    location.replace(buildRenderSettingsReloadUrl(location.href, patchForUrl));
    return true;
  }
  // 低档强制盒子代理（14 车 ×数 MB GLB 下载 + PBR 填充率是移动端主要瓶颈之一）；
  // 高/极致反向强制 GLB（履带印轨距一致性，见 QUALITY_PRESETS 注）
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
