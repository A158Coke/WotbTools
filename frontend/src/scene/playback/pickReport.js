// 点击拾取调试报告器（2026-10-24 自 initPlayback 闭包出仓为工厂，拆分计划与
// 模式说明见 docs/current-plan.md；代码与搬移前逐字一致，仅闭包读数改经 ctx 快照）。
// 纯函数（报告组装/格式化/链可见性）在 scene/pickDebug.js；本工厂只持有会话级
// 调试件（pickMarker 网格 + pickPanel DOM）。
//
// ctx 快照契约：调用方在**事件时刻**现取现传 { clock, vehicles, scenery,
// terrainMesh, groundMesh, destruct, destructPickList, meshOwner, heightField,
// heightMeta, camera, raycaster, container, scene, terrainSpan }——这些在闭包里都是
// 可变绑定，工厂创建期捕获会拿到过期值；快照式传参是「显式 state」拆分模式在
// 事件处理器上的落地形式（见 current-plan.md Design 节）。
import * as THREE from 'three'
import { nameChainOf, nearestInstance, chainVisible, meshOwnerKey, stateVisualLabel, formatPickReport } from '../pickDebug.js'

export function createPickReporter() {
  let pickMarker = null;
  let pickPanel = null;
  function reportPick(e, ctx) {
    try {
      const r = ctx.container.getBoundingClientRect();
      const nd = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ctx.raycaster.setFromCamera(nd, ctx.camera);
      const roots = [ctx.scenery, ctx.terrainMesh, ctx.groundMesh, ...ctx.vehicles.map((v) => v.group)].filter(Boolean);
      const hits = roots.length ? ctx.raycaster.intersectObjects(roots, true) : [];
      // Raycaster 不过滤 visible：隐藏 D_ 损毁网格/sky/隐藏父节点下的车辆会被
      // 命中——按整条祖先链可见性取最近可见命中，否则报告指向画面里没有的模型
      const hit = hits.find((h) => chainVisible(h.object)) || null;
      const rep = buildPickReport(hit, ctx);
      const text = formatPickReport(rep);
      console.log(text);
      try { window.__pbPick = rep; window.__pbPickText = text; } catch (_) {}
      try { window.__pbPickMesh = hit ? hit.object : null; } catch (_) {}   // 诊断：命中网格本体（控制台实时改材质用）
      showPickPanel(text, ctx.container);
      if (hit) movePickMarker(hit.point, ctx.scene);
    } catch (err) {
      // 失败必须可见（禁止静默）：面板直接显示错误，否则表现为"点击没反应"难排查
      console.warn('[scene-pick] failed:', err);
      try { showPickPanel(`[scene-pick] failed: ${(err && (err.stack || err.message)) || err}`, ctx.container); } catch (_) {}
    }
  }
  function buildPickReport(hit, ctx) {
    if (!hit) return { clock: ctx.clock, kind: 'empty', err: 'no hit（天空/空处）' };
    // 车辆归属：沿父链找 userData.eid（车辆拾取与既有选中逻辑同式）
    let o = hit.object, eid = 0;
    while (o) { if (o.userData && o.userData.eid) { eid = o.userData.eid; break; } o = o.parent; }
    if (eid) {
      const v = ctx.vehicles.find((x) => x.def.eid === eid);
      return { clock: ctx.clock, kind: 'vehicle', vehicle: v ? v.def : { eid } };
    }
    const onTerrain = (() => {
      let n = hit.object;
      while (n) { if (n === ctx.terrainMesh || n === ctx.groundMesh) return true; n = n.parent; }
      return false;
    })();
    if (onTerrain) return { clock: ctx.clock, kind: 'terrain', node: hit.object.name || 'terrain' };
    // 场景网格：世界点击点 → 游戏场景系（= gltf.scene 局部系 = destructibles pos 系）
    let scenePt = null;
    if (ctx.scenery) {
      try { scenePt = ctx.scenery.worldToLocal(hit.point.clone()).toArray(); } catch (_) {}
    }
    const chain = nameChainOf(hit.object, ctx.scenery || null);
    const mat = hit.object.material;
    const matName = Array.isArray(mat) ? mat.map((m) => m?.name || '?').join('|') : (mat?.name || '');
    // 实例归属：命中网格的精确归属优先（meshOwner——6m 倒树的树梢按「属于哪棵
    // 树」归到树上，而非按表面点到锚点的距离错联邻树）；无归属网格才按位置兜底。
    // 动画状态是可选叠加，按实例身份关联
    // 实例归属：合批后命中 = 批次 InstancedMesh + instanceId——按复合键查归属表
    //（值携带原节点名：合批后原 Mesh 已摘除，报告仍报真实物体名）；无表项才按位置兜底
    const owner = (ctx.meshOwner && hit.instanceId != null)
      ? ctx.meshOwner.get(meshOwnerKey(hit.object, hit.instanceId)) : null;
    const inst = (owner && owner.inst)
      || (scenePt ? nearestInstance(ctx.destructPickList, scenePt[0], scenePt[1], 3) : null);
    const st = inst ? (ctx.destruct?.states || []).find((x) => x.inst === inst) || null : null;
    // 地形诊断行（2026-10-11 塌陷排查工具）：命中点正下方的真值高度 / 渲染网格高度。
    // 渲染网格 = 沿 −y 对 terrainMesh 单独再打一发（与画面里的地形同一几何）。
    // ⚠️ 两个诊断变量都声明在 if 外——return 在 if 外引用它们（作用域错误曾致
    // ReferenceError: render is not defined，表现为"点击无反应"）。
    let terrain = null;
    let render = null;
    if (ctx.heightField && ctx.heightMeta) {
      try {
        const n = ctx.heightMeta.size || 512;
        const span = ctx.terrainSpan;
        // truth = 真值场在命中点的**双线性插值**（与网格的连续表面对同一口径）——
        // 不能拿最近格点值当基准：坡面上连续点 vs 格点值的差是比法误差，不是渲染缺陷
        //（2026-10-11 plant wall_03 Δ=+0.234 假警报的教训：该点在两格点之间、坡度 1 m/texel）。
        const fx = (hit.point.x / span + 0.5) * n;
        const fz = (hit.point.z / span + 0.5) * n;
        const j0 = Math.min(Math.max(Math.floor(fx), 0), n - 1), j1 = Math.min(j0 + 1, n - 1);
        const i0 = Math.min(Math.max(Math.floor(fz), 0), n - 1), i1 = Math.min(i0 + 1, n - 1);
        const tx = Math.min(Math.max(fx - j0, 0), 1), tz = Math.min(Math.max(fz - i0, 0), 1);
        const H = (i, j) => ctx.heightField[Math.min(i, n - 1) * n + Math.min(j, n - 1)];
        const truth = (H(i0, j0) * (1 - tx) + H(i0, j1) * tx) * (1 - tz)
                    + (H(i1, j0) * (1 - tx) + H(i1, j1) * tx) * tz;
        const jj = Math.min(Math.max(Math.round(fx), 0), n - 1);
        const ii = Math.min(Math.max(Math.round(fz), 0), n - 1);
        let meshH = null;
        if (ctx.terrainMesh) {
          const rc = new THREE.Raycaster(
            new THREE.Vector3(hit.point.x, 600, hit.point.z), new THREE.Vector3(0, -1, 0));
          const th = rc.intersectObject(ctx.terrainMesh, false);
          if (th.length) meshH = th[0].point.y;
        }
        const build = ctx.terrainMesh?.geometry?.userData?.terrainBuild || null;
        terrain = {
          truth,
          meshH,
          sizeAt: build ? build.sizeAt[ii * n + jj] : null,
          morph: build ? build.morphRaw[ii * n + jj] : null,
          quads: build ? build.quads : null,
          overBudget: build ? build.overBudget : null,
        };
      } catch (_) { terrain = null; }
    }
    // 渲染身份诊断（2026-10-11 "表面可拾取但不可见"排查）：命中对象的运行时渲染状态。
    // 可拾取（射线只查对象可见链）与可见（材质/实例矩阵/剔除共同决定）在这里现形。
    // ⚠️ 不依赖 heightField/heightMeta——terrain 下载失败/元数据缺失/降级时（恰是最值得排障的
    // 一类场景）本段仍必须出报告（2026-10-11 PR 评审 P3：此前被错误地包在 terrain 可用性里）。
    try {
      const o = hit.object;
      const mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
      const worldPos = new THREE.Vector3();
      o.getWorldPosition(worldPos);
      let instScale = null;
      if (o.isInstancedMesh && hit.instanceId != null) {
        const im = new THREE.Matrix4();
        o.getMatrixAt(hit.instanceId, im);
        instScale = new THREE.Vector3().setFromMatrixScale(im).toArray();
      }
      render = {
        type: o.type,
        name: o.name || null,
        matName: mats.map((x) => x.name || '?').join('|') || null,
        matType: mats.map((x) => x.type).join('|') || null,
        matVisible: mats.map((x) => x.visible).join(',') || null,
        transparent: mats.map((x) => x.transparent).join(',') || null,
        opacity: mats.map((x) => Number(x.opacity != null ? x.opacity : 1)).join(',') || null,
        alphaTest: mats.map((x) => x.alphaTest || 0).join(',') || null,
        depthWrite: mats.map((x) => x.depthWrite).join(',') || null,
        objVisible: o.visible,
        frustumCulled: o.frustumCulled,
        instanceId: hit.instanceId != null ? hit.instanceId : null,
        instScale,
        world: [worldPos.x, worldPos.y, worldPos.z].map((v) => Number(v.toFixed(1))),
        sphere: o.geometry && o.geometry.boundingSphere ? {
          c: [o.geometry.boundingSphere.center.x, o.geometry.boundingSphere.center.y,
            o.geometry.boundingSphere.center.z].map((v) => Number(v.toFixed(1))),
          r: Number(o.geometry.boundingSphere.radius.toFixed(1)),
        } : null,
      };
    } catch (_) { render = null; }
    return {
      clock: ctx.clock,
      kind: 'scenery',
      node: owner?.name || chain[0] || hit.object.name || hit.object.type,
      chain: chain.length > 1 ? chain : undefined,
      world: hit.point.toArray(),
      scene: scenePt || undefined,
      material: matName || undefined,
      inst: inst || null,
      serverIdKnown: !!(inst && inst.serverId),
      vis: st ? stateVisualLabel(st) : null,
      terrain,
      render,
    };
  }
  function showPickPanel(text, container) {
    if (!pickPanel) {
      pickPanel = document.createElement('pre');
      pickPanel.style.cssText = 'position:absolute;top:8px;left:8px;z-index:30;max-width:52ch;'
        + 'padding:8px 10px;margin:0;background:rgba(10,12,16,.86);color:#cfe3ff;'
        + 'font:11px/1.5 ui-monospace,Consolas,monospace;white-space:pre-wrap;'
        + 'border:1px solid rgba(120,160,255,.35);border-radius:6px;pointer-events:none;';
      container.appendChild(pickPanel);
    }
    pickPanel.textContent = text;
  }
  function movePickMarker(p, scene) {
    if (!pickMarker) {
      pickMarker = new THREE.Mesh(
        new THREE.SphereGeometry(0.5, 12, 8),
        new THREE.MeshBasicMaterial({ color: 0xff8a00, depthTest: false, transparent: true, opacity: 0.9,
                                      toneMapped: false }),
      );
      pickMarker.renderOrder = 999;
    }
    pickMarker.position.copy(p);
    scene.add(pickMarker);
  }
  /** 会话 teardown 回收调试件（标记网格 + 面板 DOM） */
  function dispose({ scene, disposeObject3D }) {
    if (pickMarker) { scene.remove(pickMarker); disposeObject3D(pickMarker); pickMarker = null; }
    if (pickPanel) { pickPanel.remove(); pickPanel = null; }
  }
  return { reportPick, dispose };
}
