/**
 * 实时装填条求值（纯函数；3D 标签的装填条用）。**逐发状态模型**，对齐游戏客户端。
 *
 * ── 客户端证据（Steam 客户端 `Data/`，均为 DVPL 容器） ──
 * 位置/结构：`UI/Screens/Battle/VehicleUIObjectMarker/VehicleUIObjectMarker.yaml` 的
 *   `GunNHealthContainer`（BottomUp）里 `GunStatusBattle`（70×3）紧邻血量条；
 *   `UI/Screens/Battle/GunStatusAtlas.yaml` 的 `GunStatus`（66×4）= 一根暗底
 *   （fill `rgba(0,0,0,.565)`）+ `ShellBack`（LinearLayout，间距 0）里 **N 枚 `ShellItem`**
 *   （PercentOfParent = 等分父宽），每枚自带 `#Reload` 进度填充。
 * 逐发状态（`UI/Screens/Battle/GunStatusAtlas.style.yaml`）：
 *   `.shell.loaded`  底图 alpha 1.0                       ← 已就绪
 *   `.shell.used`    底图 alpha 0.250980                  ← 已打出
 *   `.shell.loading` 底图 alpha 0 + `#Reload` 可见（0.815686） ← 装填中
 *   `.shell.locked`  底图 alpha 0.690196 + `#Reload` 隐藏     ← 空位但"还留着"（排队待装）
 * 客户端在 OTM 里显式启用锁定：`VehicleUIObjectMarker.yaml` 里
 *   `- path: "ShellBack/ShellItem"` 带 `classes: "shell lock-enabled"`；`.regular-style #ShellBack`
 *   的 `linearLayout-spacing` = 2.0（≈ 我们 14 设计 px 的分格间隙）。
 * 两档空位 alpha 的语义（1.0 满 / .69 "还在" / .25 "打掉了"）+ 弹夹/弹鼓机制差异：
 *   **弹鼓（有 f2=6 逐发装填）的空槽 = locked（.69，排队待装）**；
 *   **弹夹（只有整夹相位）的空槽 = used（.25，要等整夹重装）**。
 * 逐发美术：`UI/Screens/Battle/Shell.yaml` 的 `Shell`（20×32 竖版）= `PumpDrum.psd` 三帧
 *   （Inactive/Active/Full），装填进度用 `ProgressClip{orientation: BottomUp}`（自下而上）。
 * 容量与时长（客户端坦克数据 `configs[0]`，本机 `release/asset_pack/tank/{id}.json`）：
 *   `burst_size` = 弹夹容量 N（0 = 单发）；**`burst_interval` = 夹内"射击间隔"**；
 *   **`burst_reloads[]` = 弹鼓逐槽位的装填时长**（为空 = 该炮整夹一次性装填，即弹夹）。
 *
 * ── 相位语义（arena subtype 15/16/17；f1=eid, f2=phase, f3=时长, f4=计数）──
 *   f2=1  **剩余弹数更新**：`f4` = 弹夹/弹鼓**剩余发数**（实测 16/16 条与同车开火同刻、
 *         且 `max(f4)+1` == 客户端 `burst_size`）→ 作为"在膛发数"的**权威快照**并入时间线，
 *         即使开火事件漏报也能给出正确的在膛发数。
 *   f2=3  整夹装填：弹夹/单发的整夹重装，时长 = 整夹时长；期间整夹不可用。
 *         3D OTM 显示为**一整条不分割**的进度，完成后恢复 N 格满弹状态。
 *   f2=6  弹鼓逐发装填：**每个事件真正装填一发**，时长 = 该槽位的装填时长
 *         （= `burst_reloads` 对应槽位；实测 tank 4481 的 6.56/9.38 ≈ 7/10）。
 *   f2=7  夹内**推弹/射击间隔**（= `burst_interval`）：期间"正推上膛"的那格显示 B、
 *         完成后该格变 A，**不补弹**（弹夹/弹鼓一致——弹夹打掉一发后为 A|A|C 而非 A|A|A）；
 *         弹鼓另由 f2=6 逐发补回空槽。
 *   f2=4  装填中途时长变更：`f3` = **新生效的完整装填配置时长**（非倒计时；实测每车仅少数几档，
 *         如 8.7/7.43/13.29）。进度按**比例缩放剩余时间**（用"就绪时刻"表示进度基准：
 *         硬约束检验「开火不得早于就绪」，重置基准 9/120 违例 vs 缩放剩余 1/120）。
 *   f2=5  就绪/取消（无时长）；其 f4=1 是"就绪标志"，**不是**剩余发数。
 *   f4    **服务器剩余发数快照**（事件时刻的权威值）：实测 f2=1/6/7 上的 f4 与
 *         「开火−1、f2=6 完成+1（未被开火作废）、f2=3 完成=N」逐条一致——一律作为快照
 *         覆盖开火推导（开火事件采集有延迟会漂移）；仅 f2=5 的 f4=1 是"就绪标志"，排除。
 *
 * N 推断：优先用 `f4`（观测最大剩余 + 1 = N；与客户端 `burst_size` 逐车吻合）；
 *   无 `f4` 时回退"整夹之间的最长连续逐发相位串 + 1"；再不行按 1（单发，不猜）。
 *
 * 绘制规则（对客户端实测序列拟合）：满弹/空闲 → 分割 N 格（A=可用，C=打掉的）；
 *   f2=7 推弹期间 → 分割且 B 在"正推上膛"那格；f2=6 补槽期间 → B 在空槽那格；
 *   f2=3 整夹装填 → **一整条不分割**；开火作废进行中的装填。
 *
 * 求值一律按**时间归并 + 二分定位**（不累加计时器）→ seek / 拖动进度条天然正确。
 */

/** f2 = **剩余弹数更新**（无时长；`f4` = 弹夹/弹鼓剩余发数，权威计数） */
export const PHASE_AMMO_COUNT = 1;
/** f2 = 整夹装填（一次性；弹夹与单发的整夹重装） */
export const PHASE_START = 3;
/** f2 = 装填中途时长变更（刷新当前装填的进度基准） */
export const PHASE_DURATION_CHANGE = 4;
/** f2 = 就绪/取消（无时长；其 f4=1 是就绪标志） */
export const PHASE_READY = 5;
/** f2 = 弹鼓逐发装填（真装填一发；时长 = 该槽位装填时长） */
export const PHASE_DRUM_SHELL = 6;
/** f2 = 夹内射击间隔（**不装填**；时长 = burst_interval） */
export const PHASE_MAG_INTERVAL = 7;

/** N 的合理上限：超过即视为脏数据，退回启发式（实测最大值 6） */
const MAX_PLAUSIBLE_MAG = 10;

const clamp01 = (x) => Math.max(0, Math.min(1, Number.isFinite(x) ? x : 0));

/** 是否为有明确结束时刻的弹药阶段。f2=3/6 会在结束时改变弹量；f2=7 只结束推弹视觉，**不补弹**。 */
export function isTimedAmmoPhase(e) {
  return !!e && (e.phase === PHASE_START || e.phase === PHASE_DRUM_SHELL || e.phase === PHASE_MAG_INTERVAL);
}

/** 该车是否"按发装填"（弹鼓：相位流里有 f2=6）——决定空槽画 locked(.69) 还是 used(.25) */
export function hasPerShellReloads(events) {
  return (events || []).some((e) => e && e.phase === PHASE_DRUM_SHELL);
}

/**
 * 由客户端坦克数据取弹夹容量（静态权威）：`configs[].burst_size` 取最大
 * （弹夹参数挂在 burst 那个 config 上——实测 tank 19825 的 `configs[1].burst_size=6`、
 * tank 23329 的 `configs[1].burst_size=3`；`configs[0]` 是非弹夹配置，其值为 0）。
 * 无该字段/为 0 → 1（单发）。
 */
export function magazineSizeFromTank(tankJson) {
  const cfgs = (tankJson && tankJson.configs) || [];
  let best = 1;
  for (const c of cfgs) {
    const b = Number(c && c.burst_size);
    if (Number.isFinite(b) && b > best) best = b;
  }
  return Math.min(MAX_PLAUSIBLE_MAG, Math.round(best));
}

/**
 * 合成弹夹容量：**客户端静态值为主**（`configs[].burst_size` == 客户端 XML `<clip><count>`，
 * 已对 30 台车验证一致），再取回放相位推断的较大者（相位是回放真值，可纠正"用了非弹夹配置"
 * 之类的静态歧义）。两者都拿不到 → 1（不猜）。
 */
export function resolveMagazineSize(tankJson, events) {
  const tankN = magazineSizeFromTank(tankJson);
  const phaseN = inferMagazineSize(events || []);
  return Math.max(tankN, phaseN);
}

/** 相位条目是否参与时间归并（带正时长；f2=7 也参与——它会打断/接续装填节奏） */
export function isUsablePhase(e) {
  if (!e) return false;
  const p = e.phase;
  if (p !== PHASE_START && p !== PHASE_DRUM_SHELL && p !== PHASE_MAG_INTERVAL && p !== PHASE_DURATION_CHANGE) return false;
  const d = Number(e.duration_s);
  return Number.isFinite(d) && d > 0;
}

/** 取可用相位（保持原顺序；facet 已按 clock 升序） */
export function usablePhases(reloads) {
  return (reloads || []).filter(isUsablePhase);
}

/** 按 eid 分组：Map<eid, 该车全部相位条目（含未闭环码）>
 *  保留全量是有意的：`f4`（剩余发数）也出现在未闭环相位码上（实测 f2=1），
 *  N 推断需要它；显示用的可用相位由 shellStatesAt 内部再筛。 */
export function groupByVehicle(reloads) {
  const m = new Map();
  for (const e of reloads || []) {
    if (!e || e.eid == null) continue;
    let a = m.get(e.eid);
    if (!a) { a = []; m.set(e.eid, a); }
    a.push(e);
  }
  return m;
}

/** 推导弹夹容量 N（单发车 = 1） */
export function inferMagazineSize(events) {
  const list = events || [];
  // 首选 f4：**该次开火后剩余发数**——f4 与相位码无关（实测 f2=1/3/6/7 都带"剩余"），
  // 故扫描所有条目；只有 f2=5（就绪/取消）的 f4=1 是"就绪标志"，必须排除。
  // 相位条目只在开火/装填时产生，故剩余数取不到满夹那一次 → 观测最大值即 N−1。
  let maxRemain = -1;
  for (const e of list) {
    if (!e || e.phase === PHASE_READY) continue;
    const c = e.count;
    if (c == null || !Number.isFinite(c) || c < 0) continue;
    if (c > maxRemain) maxRemain = c;
  }
  if (maxRemain >= 0 && maxRemain + 1 <= MAX_PLAUSIBLE_MAG) return maxRemain + 1;
  // 回退：整夹之间的最长连续"逐发相位"串 + 1（无整夹相位 → 不猜，按单发）
  if (!list.some((e) => e.phase === PHASE_START)) return 1;
  let run = 0, maxRun = 0;
  for (const e of list) {
    if (e.phase === PHASE_MAG_INTERVAL || e.phase === PHASE_DRUM_SHELL) {
      run += 1;
      if (run > maxRun) maxRun = run;
    } else if (e.phase === PHASE_START) {
      run = 0;   // 整夹装填补位把「本夹内的逐发串」清零
    }
  }
  return Math.min(MAX_PLAUSIBLE_MAG, maxRun + 1);
}

/**
 * 某条定时弹药相位（f2=3/6/7）的**结束时刻**：从 `clock + duration_s` 起，将后续
 * f2=4 与 method 35 按时间顺序折入同一 ready 时间线，直到结束或被下一条定时弹药相位取代。
 * method 35 仍只作用于 f2=3；缩放公式必须与 shellStatesAt 的运行时状态机完全一致。
 */
function scheduledReady(usable, i, effList, effAt) {
  const s = usable[i];
  let dur = s.duration_s;
  if (s.phase === PHASE_START && effAt) dur = effAt(s.clock) ?? dur;
  let ready = s.clock + dur;

  // 预计算 end mark 时不能只看 f2=4：method 35 会在运行时动态修改 ready。
  // 将两类变化合并排序，确保静态 end mark 与下面 marks 归并得到同一个结束时刻。
  const changes = [];
  for (let j = i + 1; j < usable.length; j++) {
    const e = usable[j];
    if (e.phase === PHASE_DURATION_CHANGE || isTimedAmmoPhase(e)) {
      changes.push({ clock: e.clock, kind: 'phase', e });
    }
  }
  if (s.phase === PHASE_START) {
    for (const d of effList || []) {
      if (d.clock > s.clock && d.duration_s > 0) changes.push({ clock: d.clock, kind: 'eff', e: d });
    }
  }
  // 与 shellStatesAt marks 的稳定顺序一致：同一时刻 phase/begin 先于 eff。
  changes.sort((a, b) => {
    const byClock = a.clock - b.clock;
    if (byClock) return byClock;
    if (a.kind === b.kind) return 0;
    return a.kind === 'phase' ? -1 : 1;
  });

  for (const change of changes) {
    if (change.clock >= ready) break;                 // 当前装填已在变化到来前完成
    if (change.kind === 'eff') {
      const next = change.e.duration_s;
      ready = change.clock + Math.max(0, ready - change.clock) * (next / dur);
      dur = next;
      continue;
    }
    const e = change.e;
    if (e.phase === PHASE_DURATION_CHANGE && e.duration_s > 0) {
      ready = e.clock + Math.max(0, ready - e.clock) * (e.duration_s / dur);
      dur = e.duration_s;
    } else if (isTimedAmmoPhase(e)) {
      break;                                          // 新定时相位取代本次
    }
  }
  return ready;
}

/** 最后一个 clock ≤ t 的下标（二分；无 → -1） */
export function lastIndexAtOrBefore(events, t) {
  let lo = 0, hi = events.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (events[mid].clock <= t) { ans = mid; lo = mid + 1; } else { hi = mid - 1; }
  }
  return ans;
}

/**
 * t 时刻的**逐发状态**：[{ state: 'full'|'loading'|'empty', progress }]（下标 0 = 第一发）
 *
 * `durations`（可选）= 该方法 35 的"当前生效完整装填时长"序列（{clock, eid, duration_s}）。
 * 有它时：装填**起点**采用该时刻已知的权威时长；中途再来一条（消耗品/乘员/配件生效）时按
 * **缩放剩余**（M2：ready ← t + (ready−t)·新/旧）刷新——硬约束检验「开火不得早于就绪」在
 * 3 种模型里最优（2/120 违例，起点+完整时长 5/120、变更时刻+时长 30/120）。
 * - `full`    该发已在膛（客户端 `Full`）
 * - `loading` 该发正在装填，`progress` 0..1（客户端 `Active`；横向条即左→右填充）
 * - `locked`  该发空着但"排队待装"（客户端 `.shell.locked`，底图 .690196；弹鼓的空槽）
 * - `empty`   该发已打出且要等整夹重装（客户端 `.shell.used`，底图 .250980；弹夹的空槽）
 *
 * 三种装填形态：
 * - **整夹装填（f2=3）**：该夹**所有发一起**按同一进度装填，同一时刻到位（期间整夹不可用）。
 * - **弹鼓逐发（f2=6）**：只补**最左空位**那一发，进度 = 该事件时长；其余保持。
 * - **射击间隔（f2=7）**：**不补发**——空位保持空（弹夹要等整夹装填，弹鼓等随后的 f2=6）。
 *
 * @param {Array} events 该车的相位条目（升序；可用相位由内部筛）
 * @param {Array<number>} fires 该车的开火时刻（升序）——每开火消耗一发
 */
export function shellStatesAt(events, fires, t, size = 1, durations = null) {
  const n = Math.max(1, Math.round(size) || 1);
  const full = () => Array.from({ length: n }, () => ({ state: 'full', progress: 1 }));
  if (!events || !events.length) return full();

  // 归并「开火 / 相位开始 / 相位结束」三类时间标记（均 ≤ t）；只用可用相位建标记。
  // 定时弹药相位（f2=3/6/7）的结束时刻要折进其后的 f2=4 时长变更；只有 f2=3/6
  // 会在结束时改变弹量，f2=7 结束只代表推弹/射击间隔完成。
  const marks = [];
  // 方法 35：权威"当前生效完整装填时长"（**长装填刻度**）——只用于 f2=3 的进度/结算基准
  const effList = durations || [];
  const effAt = (tt) => {
    let v = null;
    for (const d of effList) {
      if (d.clock <= tt) v = d.duration_s;
      else break;
    }
    return v;
  };
  const usable = events.filter(isUsablePhase);
  for (let i = 0; i < usable.length; i++) {
    const e = usable[i];
    if (e.clock > t) break;
    marks.push({ t: e.clock, kind: 'begin', e });
    if (!isTimedAmmoPhase(e)) continue;                  // f2=4 不产生独立结束标记
    const end = scheduledReady(usable, i, effList, effAt); // end 与运行时 ready 共用 f2=4 + method35 时间线
    if (end <= t) marks.push({ t: end, kind: 'end', e });
  }
  for (const f of fires || []) {
    if (f > t) break;
    marks.push({ t: f, kind: 'fire', e: null });
  }
  for (const d of effList) {
    if (d.clock > t) break;
    if (!(d.duration_s > 0)) continue;
    marks.push({ t: d.clock, kind: 'eff', e: d });
  }
  // 服务器剩余发数快照：**所有相位**的 f4（实测 f2=1/6/7 一致 = 事件时刻的服务器值；
  // 仅 f2=5 的 f4=1 是"就绪标志"，排除）。开火事件只用于两次快照之间的推导——回放里
  // 开火时刻的采集与服务器广播有延迟，推导会漂移，快照负责纠偏。
  for (const e of events) {
    if (e.clock > t) break;
    if (e.phase === PHASE_READY) continue;
    const c = Number(e.count);
    if (e.count != null && Number.isFinite(c) && c >= 0) marks.push({ t: e.clock, kind: 'count', e });
  }
  marks.sort((a, b) => (a.t - b.t) || (a.kind === 'end' ? -1 : (b.kind === 'end' ? 1 : 0)));

  const perShell = hasPerShellReloads(events);   // 弹鼓：空槽 = locked（排队待装），非弹鼓 = used
  const emptyState = () => (perShell ? { state: 'locked', progress: 0 } : { state: 'empty', progress: 0 });
  let loaded = n;          // 在膛发数（0..N）
  let active = null;       // 当前未结束的定时弹药相位（f2=3/6/7；f2=7 仅视觉上膛，不补弹）
  // 进度用「预测就绪时刻 ready + 当前生效完整时长 dur」表示：progress = 1 − max(0, ready−t)/dur。
  // 用 ready（而非开始时刻）是为了让 f2=4 能**按比例缩放剩余时间**（见下）。
  let ready = 0;
  let dur = 0;
  for (const m of marks) {
    if (m.kind === 'count') {
      // 服务器下发的剩余发数（权威快照）：覆盖开火推导值——开火采集/广播延迟会漂移；
      // 不改变当前装填相位的进度基准
      const c = Number(m.e.count);
      if (Number.isFinite(c) && c >= 0 && c <= n) loaded = c;
      continue;
    }
    if (m.kind === 'fire') { loaded = Math.max(0, loaded - 1); active = null; ready = 0; dur = 0; continue; }
    if (m.kind === 'eff') {
      // 方法 35 的权威时长变更（消耗品/乘员/配件生效，**长装填刻度**）：与 f2=4 同式——
      // **缩放剩余**；只作用于整夹装填（f2=3）——小装填/逐发有自己的刻度，不随它跳变。
      // （硬约束检验：M2 2/120 违例，优于"起点+完整时长"5/120、"变更时刻+时长"30/120）
      if (active && active.phase === PHASE_START && dur > 0 && m.e.duration_s > 0) {
        const rest = Math.max(0, ready - m.t);
        ready = m.t + rest * (m.e.duration_s / dur);
        dur = m.e.duration_s;
      }
      continue;
    }
    if (m.kind === 'begin') {
      if (m.e.phase === PHASE_DURATION_CHANGE) {
        // f2=4 = 当前生效的**完整**装填配置时长变更（不是倒计时；实测值在少数几档间跳变）。
        // 故**不能**把基准重置成 clock+d——那样在真实数据里会出现 9/120 次"预测就绪晚于实际
        // 开火"（物理不可能）；改为**按比例缩放剩余时间**：ready ← t + (ready−t)·d′/d，
        // 同一数据集违例降到 1/120。不改变已装填发数。
        if (active && dur > 0 && m.e.duration_s > 0) {
          const rest = Math.max(0, ready - m.e.clock);
          ready = m.e.clock + rest * (m.e.duration_s / dur);
          dur = m.e.duration_s;
        }
        continue;
      }
      active = m.e;
      // 方法 35 是**完整装填配置时长**（长装填刻度）——只对 f2=3（整夹装填）生效；
      // f2=6（弹鼓逐发）/f2=7（夹内小装填）必须用相位自带的 duration_s，否则小装填
      // 会按长装填的刻度走（曾致部分弹夹车小装填看起来像长装填）。
      dur = m.e.phase === PHASE_START ? (effAt(m.e.clock) ?? m.e.duration_s) : m.e.duration_s;
      ready = m.e.clock + dur;
      continue;
    }
    // end：只结束没被开火打断的那条定时相位；f2=3/6 继续结算弹量，f2=7 只清视觉上膛态
    if (active !== m.e) continue;
    active = null; ready = 0; dur = 0;
    if (m.e.phase === PHASE_DRUM_SHELL) {
      loaded = Math.min(n, loaded + 1);        // 弹鼓 f2=6：补回一个空槽（逐发装填）
    } else if (m.e.phase === PHASE_START) {
      loaded = n;                              // 整夹装填（f2=3）：整夹补满
    }
    // f2=7（推下一发上膛的间隔）结束**不补弹**：那一格只是从 B（推弹中）变回 A（可用）
  }

  // 客户端显示模型（对客户端实测序列逐位拟合；弹夹/弹鼓一致，N=3 例）：
  //   满弹          → 分割 A|A|A
  //   打一发        → f2=7 推弹上膛期间：分割，B 在"正推上膛"那格 → A|B|C；完成 → A|A|C（不补弹）
  //   再打一发      → B|C|C；完成 → A|C|C
  //   打空          → f2=3 整夹装填：**一整条不分割**（一根慢慢延长的条），装完 → A|A|A
  //   弹鼓差异      → 另有 f2=6 逐发补回空槽：B 在第一个空槽 → A|A|B → 满；可被开火作废
  if (active && dur > 0) {
    const p = clamp01(1 - Math.max(0, ready - t) / dur);
    if (active.phase === PHASE_START) {
      return [{ state: 'loading', progress: p }];        // 整夹装填：一整条不分割
    }
    // 逐发类：B 的格位——f2=7 = 正推上膛那格（开火后 loaded 已减 1 → B 在 loaded−1）；
    //        f2=6 = 正在补回的空槽（B 在 loaded）。
    const k = Math.max(0, Math.min(n - 1,
      active.phase === PHASE_MAG_INTERVAL ? loaded - 1 : loaded));
    return Array.from({ length: n }, (_, i) => (
      i < k ? { state: 'full', progress: 1 }
        : i === k ? { state: 'loading', progress: p }
          : emptyState()));
  }
  return Array.from({ length: n }, (_, i) => (i < loaded ? { state: 'full', progress: 1 } : emptyState()));
}

/** 逐发状态 → 聚合填充比（重绘门控与旧口径兼容用） */
export function fillOf(states) {
  if (!states || !states.length) return 1;
  let sum = 0;
  for (const s of states) sum += s.state === 'full' ? 1 : s.state === 'loading' ? clamp01(s.progress) : 0;
  return sum / states.length;
}

/**
 * 逐格视觉签名：状态拓扑 + loading 的 1% 进度桶。
 * 不能只用 aggregate fill 做重绘门控：例如整夹 loading=99.6% 与完成后的 A|A|A
 * 都会把聚合 fill 四舍五入到 100%，但前者是一整条、后者是 N 个分格，必须重绘。
 */
export function reloadVisualKey(states) {
  if (!states || !states.length) return 'none';
  return states.map((s) => {
    const state = s && s.state ? s.state : 'empty';
    return state === 'loading' ? `loading:${Math.round(clamp01(Number(s.progress)) * 100)}` : state;
  }).join('|');
}

/** 聚合视图（兼容/诊断）：{ active, fill, kind, shells } */
export function reloadViewAt(events, fires, t, size = 1) {
  const shells = shellStatesAt(events, fires, t, size);
  const anyLoading = shells.some((s) => s.state === 'loading');
  return { active: anyLoading, fill: fillOf(shells), kind: anyLoading ? 'loading' : null, shells };
}
