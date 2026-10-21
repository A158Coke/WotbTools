# 装甲检视器：KRV 跳弹投影区“混色”排查进度（暂停）

状态：**2026-10-20 已定案**。5177 clip-only 对照（`backup/pre-pr713-711` + 仅
gun_mask 裁剪）已解决用户看到的显示问题；本文 §9 的 P0 修复（单样本 RT、
`NoBlending`、`moduleInFront` discard、炮管跳过 `EXTERNAL_FRAG`、20 µm/模块优先）
已在 2026-10-20 P0 清理中移除。混色带本身仍是两块主装甲板交叠/最近面翻转的独立
现象，不等同于隐藏炮管层链问题。本文保留为历史证据与复现工具。

## 1. 现象

AP/APCR 热力图，Kranvagn（tank 4481，`gun_01_armor_7` 炮盾板 / `turret_01_armor_1`
炮塔前板一带）在**跳弹后击穿的投影区**出现一条**混色带**：洋红（跳弹）与绿
（续飞击穿）逐像素交错。用户视角为射击复现的近距离掠射视角（炮盾/炮塔前板近乎
侧看）。用户期望该区域“全绿”。

## 2. 已证实的几何事实（决定性）

1. **混色带就是两块主装甲板的交叠/相交带**，不是热力图对某一块板的错误着色。
   相机射线上前两个 Primary 命中只有这一对：

   ```
   turret_01_armor_1 (225mm, sec=turret)  d = 13.089
   gun_01_armor_7    (70mm,  sec=turret)  d = 13.098   ← 仅差 9mm
   ```

   扫描（`probe_coincident_plates.js`，步长 6px，34320 采样）里“前两块主装甲距离
   < 20mm”的像素**只**来自这一对（5 个采样点全部命中），间距 8–19mm，并沿炮盾边缘
   相交——正是用户描述的“炮盾装甲板 7 在炮塔装甲板 1 上的投影区域”。

2. **混色像素的颜色 = 两块板各自单色的均值**（用户截图直接采样）：

   | 来源 | 颜色 |
   |---|---|
   | 炮塔前板（洋红） | ≈ (160, 32, 160) |
   | 炮盾板（绿） | ≈ (16, 144, 16) |
   | 混色带实测像素 | (95,111,109) / (113,97,130) / (121,77,129) ≈ 两色均值 |

   即：**同一像素同时被两块板的着色片元按样本混合**，而不是某一块板自己的
   续飞判定在翻面。

3. **三帧 A/B 定量**（`probe_mixed_map.js`：两板都在 / 隐藏 `turret_01_armor_1` /
   隐藏 `gun_01_armor_7`；“两板同时贡献”= A 与两次单板帧都显著不同）：

   | 视角（yaw/az/dist） | 修复前 mixed | 非 MSAA RT 后 mixed |
   |---|---|---|
   | 0 / 20 / 6m | 94 | **0** |
   | 10 / 30 / 6m | 238 | **0** |
   | 0 / 75 / 12m（掠射） | 118 | **0** |

   两板的贡献区域（`turretOnly` / `gunOnly`）在修复前后基本不变——只是不再按样本混色。

4. **该区域的逐像素续飞参考结果本身就是混合的**：对炮塔前板 295 个采样像素跑
   JS 参考 `simulateContinuation`，得到 cls0（无续飞）×176、cls1（续飞击穿）×86、
   cls2（续飞被挡）×33。也就是说“全绿”并不是参考实现的结论，投影边界在掠射角下
   本来就逐像素跳变。

## 3. 已排除的方向

| 假设 | 结论 | 证据 |
|---|---|---|
| 着色器/CPU 续飞实现不一致 | 排除 | 用 CPU 射线喂给 GLSL `rcContinue`（rcDebug=6）与 JS 参考同结论；24/24 采样像素 GPU/CPU cls 一致；反射方向偏差 ≈0.014° |
| 世界系续飞网格过期 | **真 bug，但与本混色无关** | 8° 车体偏航未标 dirty → 4215 采样像素中 94 个 CPU/GPU 分叉；按 `matrixWorld` 快照重建后归零。已作为确定性修复保留（§6） |
| `moduleInFront` discard 逐像素翻面（露出车体原色） | 排除 | mode7 量测：该区域是**实心**区域（48967 px，水平边缘仅 854 px），不是噪点带 |
| `underSpaced`（RT0.A）逐像素翻面翻转着色分支 | 排除 | mode7：110282 px 实心覆盖，边缘 511 px |
| 两块板“深度并列”导致两片元都通过深度测试 | 排除 | 24-bit 深度、near 0.7/far 44，13m 处量化 ≈14µm（Δz=(f−n)z²/(f·n·2²⁴)），远小于 8–19mm 间距；双板混合可被三帧 A/B 完全解释为 MSAA 样本平均 |
| 非索引/逐面法线导致的 `aHePen` 串色 | 无关 | 仅 HE 白色层；本问题为 AP/APCR |

## 4. 最后一次尝试（已回退）

**非 MSAA 离屏 RT + 合成**：主装甲热力图写入 `samples: 0` 的离屏 RT（每像素单样本、
像素中心光栅化一次），材质 `NoBlending` 直写颜色/透明度，再用全屏 quad 合成（0.5
透明度不变）。

- 效果：三视角“双板混色”像素 94/238/118 → **全部 0**（§2.3），说明混色带确实是
  MSAA 的样本平均。
- 用户反馈：**仍然“交替”**。即混色带变成了**纯色**的洋红/绿逐像素交替——原因不再是
  颜色混合，而是两块板在交叠带里的**最近面逐像素翻转**（两块壳相互穿插，像素中心的
  最近板在两者之间跳）。
- 已回退该改动（渲染管线不保留）。

## 5. 仍未回答/待决策

1. **“应该全绿”的依据**：该区域逐像素参考结果本身是 176:86:33 的混合（§2.4）。
   要让整条带全绿，必须改变“逐像素最近面/逐像素续飞”的语义，而不只是修渲染。
2. **两块重叠板是否该做确定性取舍**：例如在两板间距小于某个容差时固定取某一板
   （更厚/更外/固定顺序）。这正是仓库 AGENTS.md 禁止的“按内容统计做逐例判定”，
   除非能找到**格式/数据层面的语义判别式**（例如碰撞模型里哪块是外层壳）。
   需要用户决策。
3. **逐面法线 vs 平滑法线**：续飞用逐面法线（与点击判定同源），在三角形边界会
   产生**三角形尺度**的跳变；若用户看到的交替尺度更接近三角形大小，则应先排除
   这个来源（当前截图噪声尺度 ~1–2px，暂判为板间翻转，但未在用户视角下直接量到）。
4. **用户视角不可本地复现**：用户报错场景是射击复现（相机/炮塔来自该发弹道），
   本地自动探针用的是装甲独立页的预设视角。需要用户提供该发弹道的 URL 或一张带
   hover 的截图（hover 条会显示可见板名/厚度/`cls`/`gpu` 调试色）。

## 6. 与本问题无关、已保留的确定性修复（勿回退）

- 射击复现续飞反射方向：`__segRay.dir` 是 P1→P2 入射方向，不得二次取反。
- 世界系续飞网格按各网格 `matrixWorld` 快照判失效（`packPoseSig` /
  `ricochetPoseChanged`）——姿态入口不止 `updateTurretGun`，漏标会导致逐像素续飞
  用旧姿态网格。
- `moduleInFront` 时主装甲热力图片元 `discard`（不再把主装甲颜色画到炮管/履带表面）。
- AP 热力图不给炮管外部模块涂 `EXTERNAL_FRAG` 厚度/穿深紫。
- HE 溅射：法线方向起点、色带亮度单调、非索引逐面 `aHePen`、P0 性能优化等（更早
  已评审）。

## 7. 复现工具（脚本在 Agent 仓库 `D:/Class/Rust/Project/tmp_analysis/armor-inspector/`）

| 脚本 | 用途 |
|---|---|
| `probe_coincident_plates.js` | 找“前两块主装甲几乎共面/相交”的像素与板名对 |
| `probe_mixed_map.js` | 三帧 A/B：统计“两板同时贡献”的像素并画 ASCII 形状图 |
| `probe_plate_contrib.js` / `probe_plate_contrib2.js` | 单板贡献区域、最近板归属 |
| `probe_module_flip.js` / `probe_capture_sanity.js` | `moduleInFront` / `underSpaced` 区域形状与边缘数 |
| `probe_rc_ray_compare.js` / `probe_rc_ray_batch.js` | GPU/CPU 续飞逐像素对照（cls/rcDiag/位置/反射方向） |
| `probe_rc_stale_pose.js` | 姿态未标 dirty → 网格过期 → CPU/GPU 分叉（确定性 bug 的回归探针） |

排查时临时加过的调试钩子（已随回退移除，需要时按本文重新加）：

- `rcDebug` 2/3/4/6/7：位置偏差 / 反射方向偏差 / 绝对世界位置 / CPU 射线跑 GLSL 续飞 /
  RT 状态（moduleInFront、underSpaced、gapRicochet）。
- `__armorRicochet.__rcDiff/__rcScanSlip`：同像素 pack 全量求交 vs 网格 DDA 对照。
- `__armorRicochet.__setPlateVisible(name, on)`：临时隐藏某块板的全部克隆（A/B 三帧法）。
- `__armorRicochet.__cloneMatrix(name)`：克隆矩阵 vs 源网格 `matrixWorld`。
- `window.__armorFrameReq`：整帧 `readPixels` 读回（含 `DEPTH_BITS`/`SAMPLES`）。
- `__armorSetHullPose(yaw,pitch,roll,turret)`：按滑块路径改车体位姿（复现网格过期）。

## 8. 下次继续的建议顺序

1. 先拿到用户视角（URL 或带 hover 的截图），确认交替的**两个颜色属于同一块板还是
   两块板**（hover 条 + 临时恢复 `__setPlateVisible` 三帧法）。
2. 若交替属于两块板：确认碰撞模型里两块壳的层次关系（哪块是外层），再决定是否做
   **语义**取舍（不能用阈值/统计）。
3. 若交替属于同一块板：量三角形尺寸与交替尺度的关系，验证“逐面法线导致三角形尺度
   跳变”的假设，再决定续飞是否改用平滑法线（会与点击判定法线口径分离，需评审）。
4. 渲染侧结论（可复用）：默认帧缓冲 4× MSAA 会把同一像素覆盖到的多块板的颜色按样本
   平均；非 MSAA 离屏 RT 能消除该混合，但**不会**消除最近面逐像素翻转。

## 9. 修复落地（issue #711，2026-10-20，含 PR #713 合并）

按 issue #711 的三批方案实施，并合并 PR #713 的共面模块根因修复；尚未做用户侧视觉验收：

- **共面模块吞主装甲（PR #713）**：KRV 炮管模块与炮盾可共面。旧 DDA 消费模块后把游标
  推进 0.1 mm，跳过同距的主装甲；浮点舍入改变模块/装甲先后，形成稳定的绿紫交替。现在
  候选阶段过滤已消费模块 variant，模块消费后保留 cell 游标继续找主装甲，并接受恰好
  落在 cell 窗口上界的命中；CPU `raycastPackAll`/`simulateContinuation` 与点击续飞链
  用 `compareContinuationHitOrder` 同序。精确相等不足覆盖同一表面点的浮点噪声
  （用户 KRV 样本 Gun Barrel/Gun Plate 7 的点差 ~1e-16 m），追加 20 µm 浮点同距容差：
  ≤20 µm 模块优先、>20 µm（0.05 mm 回归间距）保留几何顺序。证据见
  `docs/research/armor-heatmap-711.md`：7 个固定点 GPU cls 从 3 个无续飞变为全部击穿，
  9×9 ROI 81/81，24 组共面/近共面 GLSL（含两种 pack 顺序）回归通过。
- **gun_mask 负侧炮管（2026-10-20 修正）**：上述 KRV 样本的 Gun Barrel 命中点在
  `gunClipPlane` 负侧（-0.8038 m），视觉上已被裁掉；只保留它会以 50 mm 外部模块
  污染概率卡。`isClippedModuleHit` 现在在点击/续飞、JS `raycastPackAll`/
  `simulateContinuation`、HE 采样与 GPU `rcContinue`（`rcClipEnabled`/`rcClipPlane`）
  统一剔除负侧 `gunBarrel`，Gun Plate 7 仍按 70 mm 参与；该样本从 BLOCKED 变
  PENETRATED，20 µm 规则改由**可见**模块夹具锁定。
- **输入/时序**：`aimFromDrag` 只在 `aiming && isDragging` 时调用（1–5px 微动不再改姿态）；
  `prepareRicochetFrame()` 先传播 `armorModel`/`tankModel`/相机世界矩阵、按双精度
  `matrixWorld` 快照精确比对并重建续飞网格、重新 `syncRicochetEnabled`，之后才进入
  RT/主图 pass；失败姿态耗尽 240 次重试后记录，姿态变化后再试；销毁网格清掉成功快照。
- **精度**：三个片元 shader 整体 `precision highp float`；`vNormal`（顶点/片元两端）、
  判定输入、`resolution`、`getDist`/逆投影矩阵、`rcGridMin/rcCell/rcGridDimsF` 显式
  `highp`；逐面法线不变，不引入屏幕导数或平滑法线。
- **单样本结果缓冲**：主装甲着色克隆改为不透明 + `NoBlending` + `depthWrite`，渲染进
  `samples: 0`、最近邻、无 mipmap 的 `primaryResultRT`；移除独立深度遮罩克隆（颜色与深度
  同一次写入）。结果纹理按原始 RGBA 合成一次（不再乘 opacity）。`moduleInFront` 仍在
  RT 内 discard，保留模块遮挡。
- **对照输入**：调试 `predict()` 先 `prepareRicochetFrame()` + 刷新距离衰减 uniform，
  再直接读取该板材质实际使用的 `penetration` uniform；`readPixels()` 提供逐像素原始
  plate/triangle ID、cls/rcDiag、GPU 起点/反射与同输入 CPU 层链。

PR #713 修的是交替的**分类根因**；本分支的单样本缓冲只消除不同分类在 MSAA 下的颜色
混合，两者互补。若用户复测仍有纯色交替，应按 §8 的原始 `cls`/`rcDiag` 对照继续定位，
不能用平滑或阈值掩盖；最终 3D 视觉仍由用户真机验收。
