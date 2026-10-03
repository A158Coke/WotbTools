/**
 * 3D 名牌的**呈现策略**（纯函数）：存活 / 阵亡两套样式 + 卡片几何与字号。
 *
 * 为什么单独一套样式：此前阵亡只做三件很轻的事（名字加 `✝`、文字压到 65% 透明度、
 * 血条不填），在 14–20 车同屏时几乎看不出差别、容易把阵亡车当成还在场上。
 * 阵亡样式改为**整体去队色 + 卡片删除线 + 数字转灰 + 不画装填条**：
 * - 去队色：名字 / 血槽 / 数字全部走中性灰，绿的红的都不再出现；
 * - 删除线：卡片对角一条灰线（"划掉"的语义，一眼可辨，不遮挡文字）；
 * - 不画装填条：阵亡车没有装填状态，继续画会把最后一帧的装填态读成"还在装填"；
 * - 受击闪只在存活时生效（阵亡车不会再掉血）。
 *
 * 卡片面（2026-02 重做）：**取消大面积不透明黑底**。旧实现给整张 512×140 卡片铺
 * `rgba(0,0,0,.55)`（阵亡 .78），14 车同屏时等于在战场上盖十几块黑板，遮住地形、
 * 车模与弹道。现在对比度由**描边 / 柔光**承担，只保留两个小圆角胶囊：
 *   - `hpPillFill`   —— 血量数字后面的一小块（承载"数字在什么底色上"）；
 *   - `hpTrackFill`  —— 血条空槽。
 * 两者都按内容宽高定尺寸，绝不铺满整张卡片。
 *
 * 与 2D 名牌的关系：2D（`.pb-labels`）当前只做"文字压到 65%"。本模块只服务 3D。
 */

/** 阵亡态的中性灰（与卡片里原有的压暗灰 #4a525c 同族，提亮一档保证可读） */
export const DEAD_GRAY = '#9aa3ad'

/**
 * 卡片设计坐标系（`LABEL_DESIGN_H` = 1 单位；绘制全部用这套绝对像素，
 * 由 `drawLabel` 用 `ctx.scale(h / LABEL_DESIGN_H)` 映射到实际贴图）。
 *
 * 每一行的高度是**可选行**的增量：昵称 / 车型 / 血量三行按当前标签偏好取舍（见
 * `vehicleLabelRows`），贴图始终按满行高度 `LABEL_DESIGN_H` 归一化，所以字号与
 * "开着哪几行"无关。
 */
export const LABEL_DESIGN = Object.freeze({
  padX: 18,
  padTop: 10,
  padBottom: 8,
  starW: 34,
  rowName: 42,        // 玩家昵称 / 车型行高
  rowHp: 34,          // 血量数字行高
  barH: 16,           // 血条高
  gapBar: 4,          // 数字行 ↔ 血条间距
  gapReload: 5,       // 血条 ↔ 装填条间距
  reloadH: 9,         // 装填条高
  fsTank: 36,         // 车型名（主行）
  fsPlayer: 32,       // 玩家昵称（可选行，比主行小一档）
  fsHp: 30,           // 血量数字与百分比
  reloadGap: 12,      // 装填条分格间隙
  reloadInset: 2,
});

const D = LABEL_DESIGN

/**
 * 卡片设计高（所有行都开着时的最大高度）。贴图恒以这个高度归一化，
 * 所以"哪些行开着"不会改变字号，只改变实际画多高。
 */
export const LABEL_DESIGN_H = D.padTop + D.padBottom
  + D.rowName * 2 + D.rowHp + D.gapBar + D.barH + D.gapReload + D.reloadH

/** 卡片设计宽高比（w/h）——贴图尺寸、按距离定标都用它 */
export const LABEL_DESIGN_W = 560
export const LABEL_ASPECT = LABEL_DESIGN_W / LABEL_DESIGN_H

/**
 * 卡片设计高 → 屏上最小高度系数。
 *
 * 恒定屏占比本身是对的（远近一致），但它会把**近处**的车牌一并压到看不清：
 * 653px 视口下 140 设计 px 只落到 19.7 CSS px。这里给一个屏幕像素下限
 * （`MIN_LABEL_CSS_PX`），换算成等价的屏占比系数——两者取大即得
 * "要么按距离、要么按可读下限"的最终定标系数。
 */
export const MIN_LABEL_CSS_PX = 26

export function minLabelFrac(viewportH) {
  const h = Number(viewportH)
  if (!(h > 0)) return 0
  return MIN_LABEL_CSS_PX / (h * LABEL_DESIGN_H)
}

/** 贴图分辨率：跟随实际屏幕像素（×超采样），并夹在「屏幕像素」与「设计像素」之间 */
export function labelTexHeight(cssH, devicePixelRatio, texSs) {
  const pr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1
  const px = Math.max(0, cssH) * pr
  return Math.max(1, Math.min(LABEL_DESIGN_H, Math.round(px * texSs)))
}

/** 3D 名牌字体栈（与 2D `.pb-labels` 同族；场景内核不参与 i18n，故此处固定） */
export const LABEL_FONT = '"Segoe UI", "Microsoft YaHei", sans-serif'

/** 按字号度量文本宽度：不依赖 ctx 当前的 font 恰好是什么 */
export function measureTextAt(ctx, text, fontSize) {
  ctx.font = `700 ${fontSize}px ${LABEL_FONT}`
  return ctx.measureText(text).width
}

/**
 * 标签偏好（共享回调放层）+ 阵亡态 → 这一帧画哪几行。
 *
 * **默认值就在这里**（昵称关 / 车型开 / 血量开 / 装填开），与
 * `usePlaybackPreferences` 的持久化默认一致；阵亡车不画装填——继续画会把最后一帧的
 * 装填态读成"还在装填"。
 */
export function vehicleLabelRows(prefs, dead) {
  const p = prefs || {}
  return {
    player: p.showPlayerName === true,
    tank: p.showTankName !== false,
    hp: p.showHp !== false,
    reload: p.showReload !== false && !dead,
  }
}

/**
 * 存活 / 阵亡两套样式。
 * @param {boolean} dead
 * @returns {{
 *   hpPillFill: string, hpPillStroke: string,
 *   namePrefix: string, nameColor: string | null,
 *   hpTrackFill: string, hpTextColor: string, hpPctColor: string,
 *   strike: boolean, strikeColor: string, strikeW: number,
 *   showReload: boolean, flash: boolean,
 * }} nameColor = null 表示"用队色"（存活态由调用方按阵营决定）
 */
export function labelVisual(dead) {
  if (!dead) {
    return {
      // 数字胶囊：只在文字后面垫一小块，不是整张卡片的底
      hpPillFill: 'rgba(0, 0, 0, .34)', hpPillStroke: 'rgba(255,255,255,.12)',
      namePrefix: '', nameColor: null,
      hpTrackFill: 'rgba(0, 0, 0, .42)', hpTextColor: '#ffffff', hpPctColor: 'rgba(255,255,255,.82)',
      strike: false, strikeColor: 'transparent', strikeW: 0,
      showReload: true, flash: true,
    }
  }
  return {
    // 阵亡：**不再加深卡面**（旧实现把黑底提到 .78，反而更挡战场）——
    // 只把数字胶囊压得更淡、文字转灰，弱化而不是加粗。
    hpPillFill: 'rgba(0, 0, 0, .26)', hpPillStroke: 'rgba(150,158,168,.30)',
    namePrefix: '✝ ', nameColor: DEAD_GRAY,
    hpTrackFill: 'rgba(0, 0, 0, .30)', hpTextColor: DEAD_GRAY, hpPctColor: DEAD_GRAY,
    // 删除线要压在不透明的血条与数字之上（绘制顺序见 drawLabel），故取值偏实：
    // 太淡会被深色血槽吃掉，太重又会压掉名字可读性
    strike: true, strikeColor: 'rgba(178,186,196,.55)', strikeW: 7,
    showReload: false, flash: false,
  }
}
