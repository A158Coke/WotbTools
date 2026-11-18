/** Battle Playback direction and map-view geometry. */

type PanZoomView = { scale: number; tx: number; ty: number }

/** 角度归一化到 [-180, 180)。 */
export function normalizeDeg(a: number) {
  return (((a + 180) % 360) + 360) % 360 - 180
}

/**
 * 地图 yaw → 屏幕旋转角（CSS/SVG rotate，正值=屏幕顺时针）。
 * 地图约定：yaw 从北(+Z)起顺时针为正；屏幕：+Y 向下。两次翻转（Z→−Y 镜像与 y-down 顺时针）抵消，
 * 故 screenRotate = yawDeg（0=朝上、90=朝右/东、180=朝下、270=朝左），四个基准方向已用公式验证。
 */
export function screenRotation(yawDeg: number) {
  return normalizeDeg(yawDeg)
}

/** 炮塔世界方向 = normalize(hullYaw + turretRelativeYaw)（单位：度）。 */
export function turretWorldYawDeg(hullYawDeg: number, turretRelativeYawDeg: number) {
  return normalizeDeg(hullYawDeg + turretRelativeYawDeg)
}

/** 地图视图缩放范围。 */
const VIEW_MIN_SCALE = 1
const VIEW_MAX_SCALE = 4

/**
 * 以屏幕锚点 (px, py)（相对地图容器左上的**屏幕坐标**，即 clientX/Y − getBoundingClientRect().left/top，
 * 未经任何变换）缩放视图：
 * s' = clamp(s × factor, min, max)；t' = p − (p − t)·(s'/s)。
 * 契约：该公式保证锚点屏幕位置下的地图内容点在缩放前后不变
 * （(px − tx)/scale 与 (py − ty)/scale 保持不变），translate 单位为屏幕像素。
 * 调用方（wheel/pinch）必须传入屏幕坐标，不得混入内容坐标。
 */
export function zoomViewAt(view: PanZoomView, px: number, py: number, factor: number, minScale = VIEW_MIN_SCALE, maxScale = VIEW_MAX_SCALE) {
  if (!view || !Number.isFinite(view.scale) || !Number.isFinite(factor) || factor <= 0) return view
  const next = Math.min(maxScale, Math.max(minScale, view.scale * factor))
  const ratio = next / view.scale
  return {
    scale: next,
    tx: px - (px - view.tx) * ratio,
    ty: py - (py - view.ty) * ratio
  }
}

/**
 * 平移钳制：基于「可见 stage（viewW/viewH）」与「rendered map rect（mapW/mapH）」。
 * - 地图（mapW*scale）大于 stage → 允许平移（tx/ty ∈ [stage - scaled, 0]），
 *   即使 scale≤1（cover 下被裁切区域必须可达）。
 * - 地图小于/等于 stage → 居中（tx = (viewW - scaledW)/2）。
 * pan bounds 依据 stage 与 rendered map rect，而非 map 自身尺寸。尺寸未知（≤0）时不做钳制。
 */
export function clampViewPan(view: PanZoomView, viewW: number, viewH: number, mapW = viewW, mapH = viewH) {
  if (!view || !Number.isFinite(view.scale)) return view
  const s = view.scale
  const known = Number.isFinite(viewW) && viewW > 0 && Number.isFinite(viewH) && viewH > 0
    && Number.isFinite(mapW) && mapW > 0 && Number.isFinite(mapH) && mapH > 0
  if (!known) {
    // 尺寸未知（如无布局的测试环境）：scale<=1 复位到基视图；scale>1 按旧 viewW/viewH clamp。
    if (s <= 1) return { scale: s, tx: 0, ty: 0 }
    const noW = !Number.isFinite(viewW) || viewW <= 0
    const noH = !Number.isFinite(viewH) || viewH <= 0
    const txMin = noW ? -Infinity : viewW * (1 - s)
    const tyMin = noH ? -Infinity : viewH * (1 - s)
    return {
      scale: s,
      tx: noW ? view.tx : Math.min(0, Math.max(txMin, view.tx)),
      ty: noH ? view.ty : Math.min(0, Math.max(tyMin, view.ty)),
    }
  }
  // 尺寸已知：基于可见 stage 与 rendered map rect 的 bounds。
  // cover（地图大于 stage）时 scale<=1 也可平移（被裁区域可达）；地图小于 stage 时居中。
  const scaledW = mapW * s
  const scaledH = mapH * s
  let tx = view.tx
  let ty = view.ty
  if (scaledW > viewW) tx = Math.min(0, Math.max(viewW - scaledW, tx))
  else tx = (viewW - scaledW) / 2
  if (scaledH > viewH) ty = Math.min(0, Math.max(viewH - scaledH, ty))
  else ty = (viewH - scaledH) / 2
  return { scale: s, tx, ty }
}
