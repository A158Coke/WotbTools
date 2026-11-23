# 3D 回放性能研究报告（Issue 728 · Step R）

## 2026-11-18 · 跟随视角 CPU 6× 复测

基线为 `9fab17d96`。Windows、i9-14900HX、高性能电源计划、Node 24.11.1、Vite 6.4.3、Chrome 157.0.8103.79 headless，实际渲染器为 Intel UHD / ANGLE D3D11（32.0.101.6881）。官方示例为幽灵工厂，回放 SHA-256 为 `35dceae9278e9e9ffae41525b8ee66ecfec484cefd54a52f3b61ee7d73d58b14`，WASM v0.4.23 / `97ce7b55`。资产 `11.21.0_1-20261114-r1` 的内容摘要为 `sha256:98946facd8cf91a3200b45a7d5ee00ef628a0446686bd55ada8c2f070d604d17`。下面的诊断和前两张 A/B 表使用 Vite 开发构建，包含 Vue 开发模式开销。最后用生产构建关闭探针复测。

视口 678×298，舞台 663×250，DPR 1.25。mid、dynres=0、armorhl=0、默认简化车模，锁定首行 FV215b。预热后重新 seek 到 66 s，回放 1× 播放，CDP 对页面施加 6× CPU 降速。地形与场景 GLB 来自同一版本目录。外部 rAF 只计固定窗口内两个相邻时间戳之间的间隔，窗口终止后才取完整 capture，profile 单列。

| 原代码 · 每轮 30 s | 帧间隔 p99（ms） | >100 ms | >200 ms | GPU main p95（ms） | 地形 swap p95（ms） |
|---|---:|---:|---:|---:|---:|
| b2 | 70.9 | 4 | 0 | 3.82 | 2.1 |
| b4 | 95.8 | 10 | 0 | 3.38 | 1.6 |
| b5 | 62.7 | 1 | 0 | 3.53 | 2.2 |

两轮 profile 分别采到 1 和 7 个 >100 ms 外部帧间隔。在第二轮约 833 ms 的这些窗口中，Vue `flushJobs` 的调用栈累计约 244 ms，场景 `animate` 约 360 ms（内含 Three.js 主绘制约 219 ms），GC 自耗时约 98 ms，`bufferData` 自耗时约 43 ms。第一轮的同类窗口中 `flushJobs` 约 52 ms。组件栈包含车辆名牌、HUD 及传输控件。调用栈的包含时间相互嵌套。三轮 plain 中，发生地形换装的帧其 CPU render p95 为 27.7–35.3 ms，其余帧为 16.7–22.5 ms。换装回调及 GPU main 都较短；缓冲上传、Vue 刷新和其他主线程工作仍能叠加成慢帧。

**受测改动**：3D 名牌覆盖层复用值相同的车辆快照。正在装填、掉血或使用消耗品的车辆继续接收最新数值。场景的发布频率、相机、车辆运动、遮挡与画质均沿用原配置。30 秒交错顺序 A/B、B/A、A/B，A 为原代码，B 为改动。

| 配对 | p99 A → B（ms） | >100 ms A → B | >200 ms A → B |
|---|---:|---:|---:|
| 1 | 137.4 → 99.9 | 32 → 11 | 0 → 1 |
| 2 | 141.7 → 75.0 | 23 → 2 | 0 → 0 |
| 3 | 112.5 → 75.0 | 18 → 4 | 0 → 0 |

30 秒三对的 p99 配对改善中位数为 37.5 ms，>100 ms 帧数配对改善中位数为 21。测前登记阈值分别为 16.4 ms 和 6 次（初测三轮的两倍 MAD）。两种版本从同机两个本地 Vite 服务提供，第一对 B 窗口还发生一次额外诊断读取，该轮保留原始 245.8 ms 最大值。后续用同一端口切换单个组件做 60 秒独立复核。

| 同端口 · 每轮 60 s | p99 A → B（ms） | >100 ms A → B | >200 ms A → B | Long Tasks 合计 A → B（ms） |
|---|---:|---:|---:|---:|
| 1（B/A） | 50.1 → 37.5 | 1 → 0 | 0 → 0 | 2035 → 539 |
| 2（A/B） | 45.7 → 41.7 | 0 → 2 | 0 → 0 | 1204 → 797 |
| 3（B/A） | 58.4 → 41.6 | 6 → 0 | 0 → 0 | 3060 → 901 |

60 秒复核在同一临时检出使用同一 Vite 服务，前后只切换名牌组件，均从约 66 s 播放到 126 s。每轮验证实际下载地形与场景 GLB 的目录及其版本印记。三对 p99 同向，配对改善中位数 12.6 ms；>100 ms 事件稀少，第二对反向。这一组支持本机默认 mid 档的 p99 改善，效应小于 30 秒组；它没有复现 30 秒组的改善幅度。操作系统负载、GPU 驱动和开发构建都是外推边界。Android 表现需独立采样。

**候选代码正确性复核**：保留每次内容发布时的伤害数字布局失效通知，以覆盖字体和容器重排。在同一官方样本原始回放时钟 66 s / 95 s 暂停，原版 1×、候选版 1× 和独立启动的候选版 6×，两个时点各 14 行名牌的可见性、文本、血条宽度和逐发装填状态摘要分别相同。66 s 对应 HUD 战斗时间约 00:53。保留截图供核对。一次连续多页运行在 6× 采集后的首个视觉断言未得到可见名牌，其性能样本保留，视觉结果采用独立进程复测，连续多页时该现象的原因未确认。原版和候选版各一次 follow 1× 的 p99 均为 12.5 ms，各有 0 次 >100 ms。

**其他对照**：Recorder 的 30 秒守护样本各一次。1× 的 p99 从 15.9 到 14.9 ms，>100 ms 帧均为 0；6× 的 p99 从 62.7 到 54.2 ms，>100 ms 从 0 到 1。固定 mid / follow 6×，候选树另一次无探针外部 rAF 的 p99 为 55.6 ms，>100 ms 为 2。单轮无法估计探针开销。high 的 8 秒检查载入真实车辆 GLB（192 张纹理），1004 个场景帧里 512 帧有有效镜像 GPU 查询；mid 样本为 0 帧。三角数、回放倍速、资产摘要和场景类型已进入实际 capture。

**生产构建，关闭场景探针。** 采用同一版本 WASM、真实地图资产、本地测试登录替身、Vite 生产优化和外部 rAF。Chrome 硬件渲染、镜头、场景和 CPU 降速同上。回放时间由进度条直接核验。每格独立启动 Chrome，30 s、三对交错。入口包 A 为 `main-DZk5lF5m.js`，B 为 `main-DMfQvCfm.js`。

| 生产包配对 | p99 A → B（ms） | >100 ms A → B | >200 ms A → B |
|---|---:|---:|---:|
| 1 | 37.5 → 40.1 | 0 → 0 | 0 → 0 |
| 2 | 42.8 → 45.3 | 0 → 0 | 0 → 0 |
| 3 | 39.8 → 33.3 | 0 → 0 | 0 → 0 |

**交付决定**：生产包六次均未复现 >100 ms 长帧。p99 有两对略慢、一对改善，配对改善中位数为 −2.5 ms，未达到预设收益门槛。保留采集脚本与探针改进，名牌快照复用及其依赖已从待交付运行时代码撤回。候选补丁和原始采集在本机保存。开发构建的 Vue 调用栈可解释调试场景的部分长帧，无法据此认定用户正式包有相同瓶颈。真机上的地形更新和内存/温控仍需其自身的证据。


### 生产包第二轮：同步视口读取

在原版生产包上关闭场景探针，两次独立采集 CDP CPU profile 和浏览器时间线。标记使用页面 performance 时间，按固定窗口 rAF 的 p99 划分尾部。诊断页临时量取 DOM 宽/高与 GL 缓冲提交原生调用，仅记录 ≥1 ms 的调用。该诊断运行只用于归因，帧时改善另用无挂钩的生产包测量。

| 30 s 诊断样本 | 外部帧 p99 | ≥1 ms 的场景 clientWidth / clientHeight 合计 | ≥1 ms 的 bufferData 合计 | 主线程 UpdateLayoutTree 次数 |
|---|---:|---:|---:|---:|
| 1 | 45.8 ms | 143 + 403 ms | 250 ms | 3504 |
| 2 | 54.1 ms | 199 + 475 ms | 345 ms | 3157 |

第一组的尾部窗口约 1046 ms，含约 66.5 ms 样式树更新、54.2 ms 布局及 93.0 ms MajorGC；第二组约 1216 ms，对应 87.2、58.2、59.5 ms。调用栈将舞台宽度读取定位到标签锚点投影，高度读取主要在 updateBattleFx → getViewportHeight。后者发生在本帧标签 DOM 写入之后。以上为部分可归因成本。渲染器已经在初始化、ResizeObserver 及 DPR 切换时持有实际画布的逻辑尺寸。第二候选只将上述消费者改到 WebGLRenderer.getSize，诊断脚本记录的 GPU 提交路径与地形换装保持原样。


**生产包、无场景探针、无原生调用挂钩，30 s 交错对照。** Chrome Performance.getMetrics 在窗口边界记录渲染进程主线程任务时间以及样式重算次数，除以外部 rAF 帧数。任务耗时是 Chrome 的 TaskDuration 口径。采集到的全部区间中位数和配对差值中位数分别计算。

| 配对 | p99 A → B（ms） | 主线程任务 ms/帧 A → B | 样式重算次/帧 A → B | >100 ms A → B |
|---|---:|---:|---:|---:|
| 1 | 41.6 → 41.5 | 17.13 → 14.52 | 2.20 → 1.20 | 0 → 0 |
| 2 | 41.7 → 33.5 | 15.77 → 14.32 | 2.11 → 1.20 | 0 → 0 |
| 3 | 42.6 → 37.5 | 16.65 → 15.06 | 2.12 → 1.21 | 0 → 0 |

p99 配对改善中位数 5.1 ms，高于动手前用原版生产包三轮波动估定的 4.6 ms 门槛（两倍中位绝对偏差）。主线程任务耗时每帧分别减少 15.2%、9.2%、9.6%，中位数 9.6% 略低于独立的 10% 效率目标；每帧样式重算次数的配对降幅中位数为 43.3%。两版六次 >200 ms 也均为零。该片段支持优化尾部帧时及减少样式重算，无法估计罕见 >100 ms 帧的下降幅度。


同设置的一次候选生产包 trace 中，场景 clientWidth/clientHeight 超过 1 ms 的记录为 0，1823 个外部帧有 1823 次 UpdateLayoutTree。原版两轮分别为 3504/1829、3157/1618。候选的 bufferData 慢调用仍累计约 258 ms，说明这次改动具体削减的是同步样式更新。

以上外部 rAF 表沿用历史采集脚本的分位数位置 round(p×(n−1)) 和原先登记的阈值。敏感性核对：从同一批原始时间戳改按场景探针的 nearest-rank 算法重算，视口改动三对 30 秒的 p99 配对改善中位数为 4.4 ms，低于原定 4.6 ms。故 p99 数值改善对分位数估算方法敏感，样式重算减少有独立证据。后续采集的 stat.nearestRank 与历史列并存。

| 视口尺寸候选，60 s | p99 A → B（ms） | 主线程任务 ms/帧 A → B | 样式重算次/帧 A → B |
|---|---:|---:|---:|
| 1 | 33.4 → 37.4 | 13.38 → 13.26 | 1.75 → 1.19 |
| 2 | 35.5 → 41.7 | 13.37 → 15.03 | 1.78 → 1.21 |
| 3 | 41.6 → 37.5 | 14.21 → 14.83 | 1.76 → 1.20 |

60 秒组均无 >100 ms 帧。样式重算次数在长片段三轮仍下降，但 p99 两轮上升、一轮下降，配对中位数为增加 4.0 ms。此处只确认消除了重复布局读取，不把 30 秒的帧时收益外推到整个回放。独立页面在原时钟 66 s 与 95 s 检查名牌，后一个时点把视口改为 840×420、设备 DPR 改为 2。A、B 的名牌摘要均一致，两次可见锚点与基线相差 0 CSS px。画布 CSS 尺寸分别为 663×250 / 703×418，绘图缓冲均为对应的 828×312 / 878×522。

### 生产包第三轮：重复名牌锚点 DOM 写入

三组都使用原始回放时间 66–126 s、CPU 6×、同一 Chrome 版本和真实资产，关闭场景探针。A 是原版，B 只复用逻辑视口，C 在 B 上跳过位置、可见性和遮挡值均相同的锚点 DOM 写入，保留伤害数字逐帧更新。A/B/C 的生产入口分别为 `main-DZk5lF5m.js`、`main-CXIP6F71.js`、`main-CUnisq6X.js`。每轮以 ABC、CAB、BCA 顺序轮换，独立启动 Chrome。

| 轮 | 前 30 s p99 A/B/C（ms） | 完整 60 s p99 A/B/C（ms） | 60 s 主线程任务 A/B/C（ms/帧） |
|---|---|---|---|
| 1 | 40.6 / 41.8 / 37.4 | 37.6 / 45.7 / 33.4 | 13.14 / 17.40 / 12.26 |
| 2 | 45.8 / 33.3 / 33.3 | 41.7 / 33.2 / 33.4 | 14.45 / 12.71 / 13.22 |
| 3 | 37.5 / 33.4 / 33.4 | 33.4 / 37.4 / 33.2 | 13.45 / 12.98 / 11.95 |

九次均无 >100 ms 帧。B→C 的 60 秒 p99 配对改善中位数 4.2 ms，每帧任务耗时配对降幅中位数 7.95%；A→C 分别为 4.2 ms 和 8.51%。两项均低于测前登记的 4.6 ms / 10% 门槛。两种视口下名牌内容摘要相同，C 相对 A 的可见锚点最大差为 0.001 CSS px。因此锚点候选另存为本机可复测补丁，待交付渲染路径只保留 B。B 的确定收益是消除逐帧同步尺寸读取及降低样式重算次数。两批 60 秒 p99 结果都存在反向样本，不据此承诺整段 FPS 或真机长帧改善。


在单独的 15 秒 MutationObserver 运行里，B 的 1009 帧触发 16224 次名牌 hidden 属性写入，C 的 1085 帧只触发 1 次；style 属性写入分别为 894 和 975 次（约 0.89/0.90 次每帧）。该实验独立于评分，说明 C 消除了冗余属性写入，也说明操作次数的下降未必等价于用户可感知的尾帧收益。

### 完整的四格基线

原版开发构建、场景探针开启，每格三次独立采集。follow 从原始时钟 66 s 起，Recorder 从 40 s 起。同一份原始时间戳按固定 30 s 前缀和完整 60 s 分开统计；两个时长共享首段。每个单元按采集顺序列出三次结果。

| 相机 / CPU 降速 | 窗口 | p99（ms） | >100 ms 次数 | >200 ms 次数 |
|---|---|---|---|---|
| follow / 1× | 30 s | 8.4 / 8.3 / 8.3 | 0 / 0 / 0 | 0 / 0 / 0 |
| follow / 1× | 60 s | 8.4 / 8.3 / 8.2 | 1 / 0 / 0 | 0 / 0 / 0 |
| follow / 6× | 30 s | 58.2 / 45.7 / 50.0 | 1 / 0 / 1 | 0 / 0 / 0 |
| follow / 6× | 60 s | 50.1 / 45.7 / 58.4 | 1 / 0 / 6 | 0 / 0 / 0 |
| Recorder / 1× | 30 s | 20.8 / 12.7 / 12.7 | 0 / 0 / 0 | 0 / 0 / 0 |
| Recorder / 1× | 60 s | 20.8 / 16.7 / 16.7 | 0 / 0 / 0 | 0 / 0 / 0 |
| Recorder / 6× | 30 s | 108.4 / 50.2 / 62.5 | 11 / 0 / 1 | 0 / 0 / 0 |
| Recorder / 6× | 60 s | 104.1 / 66.8 / 83.5 | 18 / 1 / 5 | 0 / 0 / 0 |


**最终集成检查**：工作树对齐含 #1063 地形拆分的 main `87fefabff` 后，447 项定向测试、类型检查、Web 构建、Web bundle 分离检查及 Android 前端 bundle 构建通过。新生产构建（本机测试登录替身）运行同回放 follow 6× 的 12 秒冒烟，成功采到 854 个场景帧和 36 次地形重建，资源为 445 个几何体、148 张纹理。两个固定时刻的 14 行名牌摘要仍与原版相同，可见锚点最大偏差 0.024 CSS px。此处验证新主干集成，不与旧提交的长窗口拼接；Android 真机帧时和热状态留在 #728。

> **【更正 2026-11-11】桌面 Chrome 那一轮（§0 第 1–6 条、§3、§4.1–4.2、§6、§7 中所有来自桌面的结论）作废。**
> 原因：采集 URL 带了空的 `assets=` 参数（`scratch/lib.mjs`），覆盖了 dev server 的资产代理，页面没有加载地形和车辆模型
> （`resources` 仅 10 个几何体 / 1 张贴图，`renderMs`≈0.2 ms，无 `terrain-build` 事件）。修正（去掉空 `assets=`）后同一回放：
> `resources` = 819 / 146，follow 与录像者视角都出现大量 `terrain-build`（30 s 内 48–100 次）和 >100 ms 长帧，**桌面同样复现，且与 §10 模拟器同因（同步地形 LOD 重建）**。
> 桌面「未复现长帧 / 重建 0 次 / 标签 DOM 层为主因 / GPU 主 pass 0.4 ms / 装甲高亮不执行」均不可引用。§10（GeckoView 模拟器）不受影响。
>
> ## Step 0 Before 基线（桌面 Chrome，修正后，当前提交 6235e1e97，同步重建）
> 环境：Chrome 157 headless + 真 GPU，示例回放 `championship-maus-example`，视口 678×298、dpr 1.25、`q=mid&dynres=0&armorhl=0`，每格 30 s、3 次，follow 起点游戏时间约 66 s、录像者约 40 s，脚本 `scratch/matrix.sh` + `scratch/summarize.mjs`，汇总 `scratch/summary-before.md`。
>
> | 格 | >100 ms 帧（3 次） | >200 ms 帧 | terrain-build 次数 | 单次构建 p50 |
> |---|---|---|---|---|
> | follow 1× | 84–99 | 4–19 | 96–100 | 123–144 ms |
> | follow 6× | 35–44 | 31–37 | 28–34 | 696–904 ms |
> | 录像者 1× | 50–53 | 4–16 | 48–53 | 122–141 ms |
> | 录像者 6× | 63–72 | 34–35 | 15–16 | 852–1215 ms |
>
> 6× 节流时帧数少（60–142 帧/30 s），帧数计数偏向「每帧都是长帧」，对比时同时看 >200 ms 数与 p99。
>
> ### 验收阈值（Step 0 基线后固定，After 之前写入，之后不得改动）
> 1. **主判据**：每格 After 的 >200 ms 帧数 = 0（1× 与 6× 均如此）。
> 2. >100 ms 帧数：After 的最大值 ≤ Before 最小值 − 2×Before 极差。即 follow 1× ≤ 54、follow 6× ≤ 17、录像者 1× ≤ 44、录像者 6× ≤ 45。
> 3. 不是藏成本：After 的 terrain-build 次数 ≥ Before 最小值的 80%：follow 1× ≥ 77、follow 6× ≥ 23、录像者 1× ≥ 39、录像者 6× ≥ 12；`mode` 全为 `worker`；`swapMs` p95 < 8 ms。
> 4. 内容不变：字节相等测试通过（自动化，不在测量里）。
> 5. 模拟器 Before 仍是 §10 的单次数据（无重复）；模拟器 After 取决于能否本地构建含修复的 debug APK，见 Step 4 记录。
>

范围：只研究、不修复、不提方案。证据标注：**已测**（本次实测/CSV 直接计算）、**已读**（读代码得到的静态事实）、**仅推断**、**未能验证**。

> ## Step 4 After 结果（桌面 Chrome，含修复的提交，同环境同回放同时间窗，每格 3 次）
> 汇总 `scratch/summary-after.md`（Before：`scratch/summary-before.md`），长帧归因 `scratch/longframes2.mjs`。
>
> | 格 | >100 ms 帧 Before → After | >200 ms 帧 Before → After | terrain-build 次数 Before → After | After `mode` / swapMs p95 |
> |---|---|---|---|---|
> | follow 1× | 84–99 → **1/1/1** | 4–19 → 1/1/1 | 96–100 → 86–87 | worker / 0.2 ms |
> | follow 6× | 35–44 → 32/9/23 | 31–37 → 3/1/1 | 28–34 → 82–93 | worker / 0.9–1.8 ms |
> | 录像者 1× | 50–53 → **1/1/1** | 4–16 → 0/0/0 | 48–53 → 43–45 | worker / 0.2 ms |
> | 录像者 6× | 63–72 → 10/97/90 | 34–35 → 2/26/25 | 15–16 → 25–51 | worker / 1.5–3.7 ms |
>
> **对照上面固定的阈值：**
> 1. >200 ms 帧 = 0：**1× 下的残余 1 帧（follow 全部 3 次、录像者 0）是窗口末尾 `stopCapture` 的采集边界假象**（报告 §10.6 已记录同类现象；该帧在采集时间轴的 30.4 s 处，同一窗口内逐帧 `cpuFrameMs` 最大仅 19 ms、`cpuFrameMs>100` 的帧数为 0；Before 同位置也有）。窗口内真实长帧为 0（Before：`terrainCheckInclusiveMs>50` 的帧 100 个、`cpu>100` 85 个）。**6× 下未达标**：follow 1–3 个、录像者 2–26 个 >200 ms 帧。
> 2. >100 ms 帧数 ≤ Before 最小值 − 2×极差：1× 两格达标（1 ≤ 54 / 44）；**6× 两格未达标**（follow 6× 阈值 ≤17：32/9/23 中 2 次超；录像者 6× 阈值 ≤45：10/97/90 中 2 次超）。
> 3. 不是藏成本：terrain-build 次数全部 ≥ 阈值（follow 1× 86–87 ≥ 77；follow 6× ≥ 23；录像者 1× 43–45 ≥ 39；录像者 6× 25–51 ≥ 12），`mode` 全为 `worker`，`swapMs` p95 最大 3.7 ms（< 8）。**达标。**
> 4. 内容不变：Worker 入口 → 调度 → 换装与同步路径逐字节相等的自动化测试通过（`terrainLodScheduler.test.ts`、`groundGeometryData.test.js`）。**达标。**
>
> **6× 未达标的原因分析（已测，不改阈值）：** After 的 6× 长帧不来自地形重建——`terrainCheckInclusiveMs>50` 的帧为 0，`swapMs` 最大 7.7 ms；它们是 `render` 主导：录像者 6× r1/r3 的 `renderMs` p50 14–19 ms、p95 90+ ms、`renderMs>50` 约 100 帧，而同环境 r2 的 `renderMs` p50 9 ms、p95 25 ms，**重复间极差大**（Before 的同格 `renderMs` p50 也是 30–52 ms，只是被 850+ ms 的重建帧淹没：Before 6× 只有 116–140 帧）。因此 6× 数据说明「重建造成的长帧消失了，暴露出的是 6× 节流 + 本机 GPU 下 `render` 本身的波动」，**不能据此宣称 6× 长帧归零**。该波动的根因未查（GL 提交 / 新几何首次上传是否有贡献、本机 GPU 争用）——未验证。
>
> **综合判断：** 主判据按预先固定的阈值**未全部达标**（6× 的 >200 ms 与 >100 ms 帧数未达标）；1× 达标，且「重建造成的长帧」的直接证据（`terrainCheckInclusiveMs` 与主线程 `swapMs`）已消失。是否接受，由用户决定。
>
> ### PR 评审后的复测（F1：调度器不再绕过 120 ms 节流，换装后下一次重建由每帧判据 + 换装时刻起 120 ms 决定）
> 代码在评审后改动，上面的 After 表是**改前**的代码；改后的代码重采两轮（`scratch/summary-after2.md`、`scratch/summary-after3.md`）：
> - `after2_`：数字明显更差且波动极大（6× 的 >200 ms 帧 18–90、单次构建 p50 52–880 ms），同一格内重复间差几倍，部分格仍回到正常水平；采集跨越了一次会话中断、机器当时状态不明，判为**环境噪声，不作为结论**。
> - `after3_`（同矩阵、紧接着重采）：
>
> | 格 | >100 ms 帧 | >200 ms 帧 | terrain-build 次数 | swapMs p95 |
> |---|---|---|---|---|
> | follow 1× | 1/1/1 | 1/1/0（末尾采集边界假象） | 83–99 | ≤0.2 ms |
> | 录像者 1× | 1/1/1 | 0/0/0 | 33–39 | 0.2 ms |
> | follow 6× | 19/78/15 | 1/13/2 | 69–87 | ≤1.7 ms |
> | 录像者 6× | 44/7/10 | 1/1/2 | 33–42 | ≤1.6 ms |
>
> 对照固定阈值：>200 ms 帧 = 0 仍只有录像者 1× 全部满足（其余格有 1–13 个，6× 比改前的 After 更少）；>100 ms 阈值：1× 两格与录像者 6× 达标，follow 6× 阈值 ≤17 只有 2/3 次未超（19/78/15 中 19、78 超）；terrain-build 次数 ≥ 80% 阈值：follow 1×（≥77）、follow 6×（≥23）、录像者 6×（≥12）达标，**录像者 1×（≥39）有 1 次为 33**（该次帧数仅 1514、p50 20.8 ms，机器明显偏慢）。`mode` 全为 `worker`，`swapMs` p95 < 8 ms。
> 结论：F1 之后没有观察到系统性变差；但 6× 仍有残余长帧（render 主导，机器负载敏感），录像者 1× 的重建次数有一次低于阈值（慢机器下的次数下降是节流的自然结果，不是少建）。机器负载波动大是这套桌面数据的主要不确定性。
>
> **用户裁示（2026-11-11）：接受 6× 节流下阈值未全部达标，继续；该处 render 波动的根因未查，不在本 PR 范围。**
>
> **没做 / 未验证：**
> - **GeckoView 模拟器 After 未做**：本机没有 Gradle（PATH 无 `gradle`、仓库无 `gradlew`、`ANDROID_HOME` 未设），无法构建含本修复的 debug APK；安装构建工具超出授权范围。模拟器 Before 仍是 §10 的单次数据（无重复）。After 只有桌面数据。
> - **视觉核对未完成**：`scratch/visual.mjs` 的滚轮快速拉近脚本跑通了（8 次 `lateral` 触发、`swapMs` ≤0.3 ms、`queueMs` 69–139 ms，事件在 `visual/after_events.json`），但滚轮把相机推到了无地形细节的视角，截图没有信息量，已删除。贴地薄构件（铁轨）在换装延迟期间的画面**未经人看过，视觉未经用户认可**。
> - **真机未验证**：OnePlus Ace Pro 的长帧是否同因未验证。桌面上换装延迟实测（请求到返回）`queueMs` p50 约 70–120 ms，比计划预估的 0.25–0.5 s 短，但真机会更慢。
>
> **验证步骤（真机，可由不看本对话的人执行）：**
> 1. 装含本修复的 debug APK（`remoteDebuggingEnabled` 为 debug 构建才开）或在 Scene 页用 `?perf`，打开同一回放。
> 2. 录像者视角和跟随视角各播放 30 s（回放时间与 Before 相同）。
> 3. `window.__pbPerf.startCapture({durationMs:30000})`，结束后 `stopCapture()`，查看 `events` 里 `stage==='terrain-build'`：`mode` 应为 `worker`（若为 `sync-fallback`，说明 Worker 在该环境不可用，行为等同旧版）；记录 `queueMs`、`swapMs` p95、次数。
> 4. 用页面外 rAF 采样器统计 >100 ms / >200 ms 帧数，对照 Before（每秒最大帧时间中位 225 ms）。
> 5. 肉眼看快速拉近 / 转向时铁轨等贴地薄构件有没有被地形短暂盖住，并记录。

## 0. 结论摘要

**0.0（最新，GeckoView 模拟器，已测，详见 §10）**：在 Android 模拟器的 GeckoView 158 上，**跟随 / 录像者视角稳定复现了 200–580 ms 的长帧，且 100% 的 >100 ms 帧都是「地形 LOD 重建 `buildAdaptiveTerrain`」所在的帧**（follow 11/11、12/12，录像者 37/37、41/41，固定视角 0/0）。Gecko Profiler 主线程栈显示：录像者视角里 `buildAdaptiveTerrain` 占非空闲主线程时间 50%、follow 37%；three.js `render` 次之（22–49%，模拟器 GL 转译会放大这一项）。桌面 Chrome 用同一示例回放、同视口/DPR，**重建计数始终为 0**（含 6× 节流），所以桌面「没复现」与「模拟器复现」之差不在回放内容，而在运行环境；**重建被触发的具体判据（视距 / 侧向位移 / FOV / aspect 之一）本次未能读出**。GPU 路径：模拟器 WebRender 硬件合成可用、未强制软件渲染，但 WebGL 的 `RENDERER` 与 `UNMASKED_RENDERER` 都被 Gecko 打码为 `Generic Renderer`，无法直接读出（见 §10.3）。模拟器是 x86_64 + 宿主 GPU 转译，**不能当作真机结论**（见 §10.7）。

1. **桌面（Chrome + Intel Iris Xe 真 GPU）没有复现「每秒出现 200–400 ms 长帧」**。34 次采集（无节流 / 4× / 6× CPU 节流，含拖拽与滚轮）中，窗口内最大帧间隔 153 ms，≥200 ms 的帧数为 0。（已测）
2. **桌面能复现的只是「主线程被 DOM/标签层吃掉」这一类特征**：6× 节流下 top（固定）/free 视角出现每秒 2–5 次 50–125 ms 的长任务，CPU Profiler 显示这些长帧里 `(program)`（浏览器内部：样式/布局/绘制/提交）约 30–36%，其余主要是标签覆盖层（`updateLabels`、`PlaybackVehicleLabels3D.paint`、`measureDamageLayout`、Vue patch）和强制布局读取 `getViewportHeight`；`animate()` 自身只占约 4–7%。（已测，Chrome 非 GeckoView）
3. **GPU 不是桌面瓶颈**：真实 GPU 渲染主 pass 约 0.4 ms/帧。真机 GPU 占用 44% 但频率在最低档 220 MHz，与「GPU 被主线程拖着、吃不饱」一致，不是「GPU 没被调用」的证据；但 CSV 无法直接证明 WebGL/WebRender 走了硬件路径（见 §1）。
4. **覆盖缺口（重要）**：Issue 最可疑的「录像者开镜 + 准星命中敌车 + 装甲高亮 pass」**在本环境从未真正执行**。开镜时间段确实存在（三个夹具都有），但 `armorCalls` 全程为 0。调用计数显示 `renderArmorHighlight` 每帧都被调用、开镜帧里 `recorderVehicle()` 每帧被调用两次，而 `highlightEnemies / aimedVehicle / armorHighlightBlock` 一次都没被调用（除开镜进入时的预取），这与「`author?.tankData` 为空导致提前 return」吻合（仅推断，未能直接证明）。因此 **armorhl=0/1 的对比在本次实测里是无效对照**，装甲 per-pass 耗时 **未能验证**。
5. **（桌面 Chrome）地形 LOD 重建计数在所有场景（含拖拽、滚轮）均为 0；GeckoView 模拟器上则大量触发，见 0.0**，`buildTerrainGeometry` 未被触发。拖拽确实送达了控件（`onPointerDown` 24 次、`maybeRebuildTerrainLod` 逐帧执行），但未触发重建，是否真的改变了相机位姿**未能验证**。地形重建因此**未能复现**。
6. 真机的 200–400 ms 长帧、80% 主线程占用的具体子系统**仍未归因**。桌面唯一实锤的主线程热点是标签覆盖层/DOM 与强制布局（仅在 6× 节流且 top/free 视角下显著；follow 与录像者视角下很少）。

## 1. 首要问题：GPU / CPU 是否被正常使用

> 真机数据来自 `field-reports/2026-11-10-oneplus-ace-pro/` 的两份 CSV（257 个 1 s 样本）。以下数值由 `scratch/csv.py` 直接计算。

### 1.1 GPU 是否真的在用

| 判断 | 证据 | 标注 |
|---|---|---|
| 桌面 Chrome 走真实 GPU | `WEBGL_debug_renderer_info` 的 UNMASKED_RENDERER = `ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x000046A6) Direct3D11 …)`，非 SwiftShader；GPU 计时器 `status: available`，`gpu_main_ms` p50 ≈ 0.39 ms（4000+ 帧） | 已测 |
| `snapshot().identity.gpuRenderer` 能否区分软硬件 | 它取自 `gl.RENDERER`，桌面真 GPU 下也只有 `"WebKit WebGL"`，**无法区分** SwiftShader；需要 UNMASKED 才能判定（观测缺口） | 已测 |
| 真机 GPU 有持续负载 | GPU 占用均值 43.5%，最大 69%；227/257 秒 ≥20%，仅 30 秒 <20% | 已测 |
| 真机 GPU 频率 | 220 MHz 占 204/257 秒（79%），285 MHz 37 秒，324+ 共 16 秒；从未升高档 | 已测 |
| 真机是否回退软件 WebRender / 软件 WebGL | CSV 有 `Renderer`、`CanvasRenderer`、`WRRenderBackend` 线程（均值 24 / 21 / 7%），说明 WebRender 渲染线程与 canvas 渲染线程在工作；软件光栅通常表现为 GPU 占用接近 0 且 CPU 线程饱和，本数据不是这样。**但 CSV 不含 `about:support` / GL 渲染器信息，无法直接证明硬件路径** | 仅推断 / 未能验证 |
| 「GPU 被拖着吃不饱」还是「GPU 没被调用」 | GPU% 在 FPS≥70 的秒为 49.0%，FPS<10 的秒为 38.3%（低帧时 GPU 反而更闲）；FPS 与 GPU% 相关 0.17，与 GPU MHz 相关 0.31；页面主线程 80% 且与 FPS 相关 0.01 | 已测（相关性）；结论为仅推断：更像前者 |

要最终确认真机硬件路径，需要观测点：debug 构建下页面内读取 UNMASKED renderer、GeckoView 的 `about:support`（Graphics 段：WebRender / Compositing / WebGL 渲染器）。**未能验证**。

### 1.2 CPU 多核是否被用上

CSV 的 CPU 布局：CPU0–3（小核，最高 1804 MHz）、CPU4–6（中核，最高 2745 MHz）、CPU7（大核，最高 2995 MHz）。

| 指标 | CPU0–3 | CPU4–6 | CPU7 |
|---|---|---|---|
| 平均占用 | 60.1 / 59.9 / 59.5 / 60.6% | 28.0 / 27.4 / 20.3% | 62.0% |
| 平均频率 | 1533 MHz（最高 1804，≥95% 最高频仅 46% 的时间） | 1720 MHz（最高 2745，仅 27%） | 2462 MHz（最高 2995，63%） |
| 平均 M Cycles/s | 约 967 | 708 / 696 / 535 | 1801 |

（全部已测）

- **页面 JS 是否全挤在一条线程**（已读）：回放文件解析在 Worker（`replay-local/parseReplays.ts`、`canonicalRuntime.ts`、`battle-data/collector.ts`、`scene/replaySource.ts` 使用 `new Worker`）。**3D 场景运行时（`scene/playback/` 全部：地形网格构建、GLB/几何上传、标签、HUD、动画推进、装甲拾取）没有 Worker，全在页面主线程**。真机 `Isolated Web Content` 线程均值 80.3%、最大 97.4%、≥70% 的秒数 216/257、≥90% 的 43 秒，与「主线程接近占满」相符（已测）。
- **多核有没有被用上**：有 —— 小核 ≈60%×4、大核 62%、中核 20–28%；但页面主线程只有一条，线程列合计（Web 80 + Renderer 24 + CanvasRenderer 21 + WRRenderBackend 7 + AndroidUI 7 + 其他小项）约 1.5–1.7 个核，而 8 核总负载按占用折算约 3.8 个核，**线程表之外还有约 2 个核的负载来自本表未列的线程/进程**（含 Scene 采样工具自身与系统，无法区分）（已测 + 仅推断）。中核大量空闲是事实，但页面主线程不能并行，所以中核空闲本身不是问题证据。
- **主线程是否被调度在小核**：**数据不能证明**。`(cpus)` 列对 Web 线程恒为 `0-7`（那是允许亲和集，不是实际所在核）。仅有间接线索：FPS<10 的秒里 CPU7 平均 76%、中核 19%、小核 48%；FPS≥70 的秒里 CPU7 65%、中核 36%、小核 71%——差帧秒大核更忙而小核/中核更闲，与「重活在大核上」不矛盾；但 FPS 与 CPU7 占用相关仅 −0.06、与 CPU7 频率 −0.01，不构成证据（未能验证）。
- 降频：温度均值 83.9 ℃（最高 95.9），但 FPS 与温度、大核频率均不相关（|r|≤0.01）。

### 1.3 帧率上限与节拍

- 没有显式帧率上限（已读）：全仓无 maxFps/帧间隔节流；帧回调是 `requestAnimationFrame(animate)`，每个 vsync 一次。
- 影响帧率的状态机（已读）：
  - **按需渲染**：暂停且相机静止时跳过整帧（`busy` 判定）；播放中恒渲染。
  - **动态分辨率**（`dynRes.ts`，默认开）：均值 >22 ms 降一档、<17 ms 升一档，步长 0.25，下限 DPR 1，冷却 60 帧；`q=mid` 的 `maxDpr` 为 1.25 ⇒ 只有 1.25↔1.0 **一级**可调。它**不可能**产生「≥100 FPS ↔ 个位数」这样的切换（仅推断；真机上 dynres 开关未知）。
  - **失活暂停**：`setPaused` 由宿主可见性驱动，停帧而非降帧。
- 真机高帧段（≥100）与低帧段（个位数）与哪个开关对应：**未能验证**，CSV 没有状态列；桌面上没有复现这种切换。

### 1.4 「正常」基准：桌面同场景对照

桌面环境：Chrome 157 headless，1280×720，DPR 1，`q=mid`，`dynres=0`，Intel Iris Xe，rAF 约 7 ms（≈144 Hz）；夹具 `random-battle-example`，30 s 窗口。（已测）

| 指标 | 桌面无节流 | 桌面 6× 节流 top | 桌面 6× 节流 录像者开镜 | 真机（OnePlus Ace Pro） |
|---|---|---|---|---|
| 帧间隔 p50 / p95 / max | 7.0 / 13.8 / 41.5 ms | 34.7 / 62.4 / 125 ms | 20.8 / 41.6 / 83 ms | 约 66 ms（中位 15 FPS）/ — / 每秒最大帧时间中位 225 ms，最大 409 ms |
| `animate()` CPU p50 / p95 | 1.2 / 1.9 ms | 10.3 / 18.7 ms | 6.6 / 13.2 ms | 未知 |
| 主线程长任务（>50 ms）数/30 s | 0 | 113（总 6.6 s ≈ 22%） | 17（总 1.0 s） | 未知，真机 Web 线程 80% |
| GPU 主 pass | 0.39 ms | 0.45 ms | 0.40 ms | GPU 占用 44%，220 MHz |

偏离点：真机的每秒最大帧时间（225–409 ms）比桌面最差的 6× 节流（153 ms）还大约 2–3 倍；真机的 Web 线程占用（80%）远高于桌面无节流下 `animate` 的占用（约 17%）。桌面 GPU 只有 ~0.4 ms，**与真机 GPU 占用 44% 不在一个量级，且桌面分辨率仅真机的约 1/3.5**（1280×720 对 2400×1080×DPR 1.25）。

## 2. 环境与身份

| 项 | 值 |
|---|---|
| 提交 | `6235e1e97342a0c10b8036014cd8489436c3130a`（分支 `claude/designer-tool-7fb949`，工作区干净；`identity.buildCommit` = `6235e1e97`） |
| WASM | `97ce7b55a0ca3e5f22792090504df3c72e73f1c4`（v0.4.23，`wasmCommit` 同） |
| 浏览器 | HeadlessChrome 157.0.0.0（`launchChromeForCdp(chrome,{gpu:true})` = `--headless=new --ignore-gpu-blocklist`），Windows 11 |
| GPU | UNMASKED：`ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x000046A6) Direct3D11 vs_5_0 ps_5_0, D3D11)`，vendor `Google Inc. (Intel)`；`hardwareConcurrency` 20；GPU 计时器 available |
| 页面 | `http://127.0.0.1:5190/?view=replay&perf&assets=&ws-auth=1&q=<q>&armorhl=<0|1>&dynres=<0|1>`，视口 1280×720（舞台约 959×718），DPR 1 |
| 回放 | `common/fixtures/replays/random-battle-example.wotbreplay`（`replayDigest` 917d99b3…，约 301 s，13–14 车）；覆盖率扫描另用 `cw-training-15-14-example`、`tournament-14-14-example` |
| 画质/开关 | 默认 `q=mid`（移动端默认档，`terrainSeg 256`、`treadMarks:false`）；个别 `q=high`；`dynres=0`（基准），另跑一组 `dynres=1`；`armorhl` 见各场景；`logdepth` 默认关；`?perf` 开 |
| 资产 | dev server 经 `WOTB_ASSET_PROXY=https://assets.wotbtools.com`，`VITE_ASSET_BASE_URL=/__assets`；资产版本 `assetIdentity` 为 null（`identityComplete` 恒 false，观测缺口） |
| 节流 | CDP `Emulation.setCPUThrottlingRate` 1 / 4 / 6 |
| 窗口 | 每次：开始回放 → 切相机 → seek 到 t0 → 预热（6 s × max(1, rate/2)）→ 30 s 窗口（Profiler 运行 25 s）；t0：top/free/follow=60 s，录像者弧镜=125 s，录像者开镜=95 s（该段 103–110 s 为开镜） |
| 额外 | `follow`=点击名册首行；`orbit`=CDP 鼠标拖拽循环；`orbit-wheel`=自由相机拖拽+滚轮 |

**偏离计划之处**
- 端口：5173 被另一任务（`D:\Program\WotbTools-f03` 的 vite）占用，按 `local-production-dev.md` 的约定不终止他人进程，改用 **5190**。因为用了仓库已有的 Keycloak 边界替身（`browser-fixtures/use-auth-stub.js`，经 `scratch/dev-server.mjs` 注入，未改任何生产源码），登录回调不影响本次测量。
- 本 worktree 没有 `node_modules`、WASM、`.env.local`：为跑 dev server，在 worktree 里放了 **gitignored** 的辅助项——`frontend/node_modules`（junction 指向主 checkout）、`common/assets/wasm/<ref>/`（复制）、`frontend/.env.local`（复制）。均不在 git 追踪范围，需要时可删除。`git status` 只显示 `docs/research/testing/3d-perf-728/`。
- 桌面机器 GPU 本身性能强、屏幕 144 Hz，与手机不可比。

## 3. 每个场景的帧间隔与 slow-frame（rAF 外部采样）

口径：页面外注入的原生 rAF 间隔（已剔除 `stopCapture` 收尾造成的最后一个假间隔，该假象曾让所有节流运行出现 300–600 ms 的「最大帧」，在 30.0 s 处，不是真实帧）。每行单次运行，**每个场景只跑 1 次**（计划要求 ≥3 次，未做，无重复间的极差，差异小于约 10% 的不能当结论）。

下表由 `scratch/analyze.mjs` 生成；列：运行、节流、rAF 样本数、p50/p95/p99/max（ms）、>33.4/>50/>100/>200/>400 ms 帧数、longtask（PerformanceObserver）次数/总 ms/最大 ms、`animate()` CPU（`__pbPerf` cpuFrameMs）p50/p95/max、地形重建次数/检查次数、DPR 范围、armor 执行帧数。

| 运行 | 节流 | rAF n | p50 | p95 | p99 | max | >33ms | >50 | >100 | >200 | >400 | longtask 数/总ms/最大 | cap cpu p50/p95/max | 地形重建/检查 | dpr | armor 帧 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| follow-high | 1x | 4304 | 6.9 | 7.1 | 7.2 | 13.9 | 0 | 0 | 0 | 0 | 0 | 0/0.0/0.0 | 1.1/1.4/8.4 | 0/4320 | 1-1 | 0 |
| follow-high | 4x | 3071 | 7.0 | 20.8 | 21.0 | 48.6 | 7 | 0 | 0 | 0 | 0 | 1/52.0/52.0 | 5.1/7.5/27.4 | 0/3081 | 1-1 | 0 |
| follow-mid-dyn | 1x | 4304 | 6.9 | 7.1 | 7.2 | 13.8 | 0 | 0 | 0 | 0 | 0 | 0/0.0/0.0 | 0.7/1.1/6.4 | 0/4321 | 1-1 | 0 |
| follow-mid-dyn | 4x | 3855 | 7.0 | 13.9 | 14.1 | 34.7 | 1 | 0 | 0 | 0 | 0 | 0/0.0/0.0 | 2.8/4.6/22.2 | 0/3870 | 1-1 | 0 |
| follow-mid | 1x | 4305 | 6.9 | 7.1 | 7.2 | 7.3 | 0 | 0 | 0 | 0 | 0 | 0/0.0/0.0 | 0.7/1.1/9.2 | 0/4322 | 1-1 | 0 |
| follow-mid | 4x | 3977 | 7.0 | 13.9 | 14.0 | 41.7 | 4 | 0 | 0 | 0 | 0 | 0/0.0/0.0 | 2.7/4.5/21.3 | 0/3992 | 1-1 | 0 |
| follow-mid | 6x | 2537 | 7.0 | 21.0 | 34.7 | 69.4 | 35 | 1 | 0 | 0 | 0 | 1/74.0/74.0 | 4.4/7.1/34.3 | 0/2551 | 1-1 | 0 |
| free-mid | 1x | 3947 | 7.0 | 13.9 | 14.0 | 34.9 | 1 | 0 | 0 | 0 | 0 | 0/0.0/0.0 | 1.2/2.0/35.4 | 0/3960 | 1-1 | 0 |
| free-mid | 4x | 2112 | 13.9 | 27.8 | 34.8 | 125.0 | 65 | 4 | 1 | 0 | 0 | 5/362.0/116.0 | 5.0/9.4/25.9 | 0/2118 | 1-1 | 0 |
| free-mid | 6x | 1000 | 27.8 | 55.5 | 69.3 | 152.8 | 443 | 54 | 1 | 0 | 0 | 60/3479.0/125.0 | 9.7/16.4/38.0 | 0/1004 | 1-1 | 0 |
| orbit-mid | 1x | 3470 | 7.0 | 14.0 | 20.8 | 35.1 | 1 | 0 | 0 | 0 | 0 | 0/0.0/0.0 | 1.1/2.0/24.1 | 0/3539 | 1-1 | 0 |
| orbit-mid | 4x | 1743 | 13.9 | 34.7 | 48.7 | 97.1 | 127 | 11 | 0 | 0 | 0 | 12/726.0/97.0 | 5.4/10.0/24.8 | 0/1769 | 1-1 | 0 |
| orbit-mid | 6x | 792 | 34.9 | 62.6 | 76.4 | 97.3 | 493 | 162 | 0 | 0 | 0 | 160/9415.0/95.0 | 10.9/18.0/37.6 | 0/813 | 1-1 | 0 |
| orbit-wheel-mid | 1x | 3803 | 7.0 | 13.9 | 14.1 | 34.7 | 2 | 0 | 0 | 0 | 0 | 0/0.0/0.0 | 1.0/1.5/25.0 | 0/3913 | 1-1 | 0 |
| orbit-wheel-mid | 4x | 2056 | 13.8 | 34.6 | 41.7 | 76.6 | 107 | 9 | 0 | 0 | 0 | 9/535.0/72.0 | 4.8/10.3/31.3 | 0/2072 | 1-1 | 0 |
| orbit-wheel-mid | 6x | 1017 | 27.8 | 55.6 | 76.4 | 111.1 | 450 | 80 | 1 | 0 | 0 | 86/5103.0/104.0 | 9.1/16.6/35.2 | 0/1040 | 1-1 | 0 |
| rec-arcade-a0 | 1x | 4082 | 7.0 | 13.7 | 14.0 | 20.9 | 0 | 0 | 0 | 0 | 0 | 0/0.0/0.0 | 1.0/1.4/2.5 | 0/4098 | 1-1 | 0 |
| rec-arcade-a0 | 4x | 2342 | 13.8 | 20.9 | 34.6 | 69.5 | 26 | 4 | 0 | 0 | 0 | 3/186.0/68.0 | 5.0/8.3/37.1 | 0/2350 | 1-1 | 0 |
| rec-arcade-a0 | 6x | 1577 | 20.7 | 34.7 | 41.7 | 69.5 | 88 | 4 | 0 | 0 | 0 | 3/188.0/69.0 | 7.0/10.9/21.5 | 0/1585 | 1-1 | 0 |
| rec-arcade-a1 | 1x | 4082 | 7.0 | 13.7 | 13.9 | 20.8 | 0 | 0 | 0 | 0 | 0 | 0/0.0/0.0 | 1.0/1.4/3.2 | 0/4098 | 1-1 | 0 |
| rec-arcade-a1 | 4x | 2564 | 13.8 | 20.9 | 27.8 | 55.4 | 8 | 1 | 0 | 0 | 0 | 0/0.0/0.0 | 4.7/7.5/27.5 | 0/2576 | 1-1 | 0 |
| rec-arcade-a1 | 6x | 1494 | 20.8 | 34.7 | 41.7 | 90.4 | 124 | 5 | 0 | 0 | 0 | 5/297.0/84.0 | 7.3/11.3/20.8 | 0/1503 | 1-1 | 0 |
| rec-scoped-a0 | 1x | 4259 | 6.9 | 7.1 | 13.7 | 20.8 | 0 | 0 | 0 | 0 | 0 | 0/0.0/0.0 | 0.9/1.2/2.2 | 0/4276 | 1-1 | 0 |
| rec-scoped-a0 | 4x | 3121 | 7.0 | 20.8 | 21.0 | 41.7 | 7 | 0 | 0 | 0 | 0 | 0/0.0/0.0 | 3.6/6.2/11.2 | 0/3129 | 1-1 | 0 |
| rec-scoped-a0 | 6x | 1580 | 14.1 | 34.8 | 48.5 | 76.4 | 140 | 11 | 0 | 0 | 0 | 8/494.0/74.0 | 6.2/11.5/24.1 | 0/1584 | 1-1 | 0 |
| rec-scoped-a1 | 1x | 4258 | 6.9 | 7.1 | 13.6 | 27.9 | 0 | 0 | 0 | 0 | 0 | 0/0.0/0.0 | 0.9/1.2/2.3 | 0/4274 | 1-1 | 0 |
| rec-scoped-a1 | 4x | 3026 | 7.0 | 20.8 | 21.0 | 41.8 | 6 | 0 | 0 | 0 | 0 | 0/0.0/0.0 | 3.8/6.4/12.4 | 0/3034 | 1-1 | 0 |
| rec-scoped-a1 | 6x | 1472 | 20.8 | 41.6 | 55.5 | 83.2 | 192 | 16 | 0 | 0 | 0 | 17/982.0/77.0 | 6.6/13.2/21.4 | 0/1475 | 1-1 | 0 |
| top-mid | 1x | 4003 | 7.0 | 13.8 | 14.0 | 41.5 | 1 | 0 | 0 | 0 | 0 | 0/0.0/0.0 | 1.2/1.9/41.6 | 0/4016 | 1-1 | 0 |
| top-mid | 4x | 2200 | 13.8 | 27.8 | 34.7 | 69.5 | 30 | 3 | 0 | 0 | 0 | 3/173.0/66.0 | 4.9/9.1/27.0 | 0/2206 | 1-1 | 0 |
| top-mid | 6x | 888 | 34.7 | 62.4 | 76.3 | 125.0 | 480 | 104 | 3 | 0 | 0 | 113/6630.0/107.0 | 10.3/18.7/49.9 | 0/893 | 1-1 | 0 |


要点（已测）：
- 无节流下所有场景 p50≈7 ms，p99≤21 ms，最大 ≤42 ms，无 ≥100 ms 帧。
- 4× 节流：top/free/orbit 视角 p50 13.8 ms、max 76–125 ms；follow/录像者 max 35–70 ms。
- 6× 节流：top（固定）p50 34.7 ms，480 个 >33 ms 帧、104 个 >50 ms、3 个 >100 ms（最大 125 ms）；free p50 27.8 ms；录像者开镜 p50 14–21 ms；follow p50 7 ms（仅 1 次长任务）。**相机在 top/free 时最差，follow 最好**。
- 所有场景 ≥200 ms 的帧数为 0。
- dynres 开/关（follow-mid，4×）无可分辨差异（DPR 全程 1，`mid` 的 1.25 上限在 DPR 1 的桌面下无可调空间）。
- `q=high` 对比 `mid`（follow，4×）：p95 20.8 vs 13.9 ms，仅差一个量化帧，单次运行不足以下结论。

## 4. 长帧的阶段构成与调用栈证据

### 4.1 `__pbPerf` 分阶段（已测）

长帧里 `animate()` 内各阶段都很小：6× 节流 top 的 capture 内 2 个 ≥100 ms 帧（118.5 / 109.9 ms）中，`cpuFrameMs` 16.5–28 ms、update 6.1–16.2 ms、render 5.7–6.6 ms、tick 4.4–5.2 ms、camera ≈0、地形检查 ≤0.2 ms、armor 0。也就是说**长帧的大头不在 `animate()` 里**（帧间隔 110–120 ms，animate 只占 15–28 ms）。逐帧明细见 `scratch/longframes.md`。`main-thread-stall`（看门狗 50 ms 心跳）事件与 longtask 数量级一致。

### 4.2 CPU Profiler（6× 节流，25 s，采样间隔 0.5 ms；已测）

三次运行（`top-mid`、`orbit-mid`、`rec-scoped-a1`），按调用栈类别汇总：

| 类别 | top-mid | orbit-mid | rec-scoped-a1 |
|---|---|---|---|
| `(program)`（浏览器内部：样式/布局/绘制/提交等） | 30% | 36% | 33% |
| Vue 运行时（patch / props / render） | 25% | 22% | 21% |
| 标签覆盖层（`updateLabels`、`PlaybackVehicleLabels3D.paint`、`measureDamageLayout`、`PlaybackVehicleLabel` 渲染、`getViewportHeight`） | 13% | 13% | 13% |
| three.js（`updateMatrixWorld`、`setProgram` 等） | 11% | 10% | 10% |
| 场景代码（`animate`、`playback/*`） | 5% | 4% | 7% |
| 其他 | 16% | 14% | 16% |

> Profiler 本身有开销且不报告 `(idle)`；这里的占比是「有采样的时间」内的构成，不是 CPU 占用率。

长帧窗口（rAF 间隔 ≥60 ms）内的自耗时前列（top-mid，97 个窗口、合计 10.7 s）：`(program)` 2.4 s、`getViewportHeight` `playbackScene.js:502` 275 ms、Vue `get`（响应式读取）268 ms、`PlaybackVehicleLabels3D.vue:60 paint` 247 ms、`updateLabels` `labelsRuntime.ts:139` 229 ms、Vue `mark` 228 ms、`setFullProps` 161 ms、`patchElement` 114 ms、`measureDamageLayout` 92 ms。**地形、装甲、悬挂/履带形变在长帧窗口里没有出现在前列。**

录像者开镜（rec-scoped-a1，17 个窗口）同样以 `(program)`、`getViewportHeight`、标签 paint、Vue patch 为主，另有 `projectToStage` `cameraRuntime.ts:720`（录像者准星投影）24 ms；没有装甲 pass 的栈（见 §0-4）。

### 4.3 主线程长任务分布（6×，30 s；已测）

| 场景 | 长任务数 | 总时长 | 每秒次数 | 50–60 / 60–70 / 70–80 / 80–100 / 100–120 / ≥120 ms |
|---|---|---|---|---|
| top-mid | 113 | 6.6 s | 3.8 | 74 / 28 / 5 / 4 / 2 / 0 |
| free-mid | 60 | 3.5 s | 2.0 | 44 / 10 / 3 / 2 / 0 / 1 |
| orbit-mid | 160 | 9.4 s | 5.3 | 100 / 47 / 9 / 4 / 0 / 0 |
| rec-scoped-a1 | 17 | 1.0 s | 0.6 | 12 / 4 / 1 / 0 / 0 / 0 |
| rec-arcade-a1 | 5 | 0.3 s | 0.2 | 3 / 1 / 0 / 1 / 0 / 0 |
| follow-mid | 1 | 0.07 s | 0.0 | 0 / 0 / 1 / 0 / 0 / 0 |

结论（已测）：这类长任务**也出现在录像者视角，但数量少得多**（0.2–0.6 次/秒 对 top 的 3.8 次/秒），且全部 <130 ms。与真机 200–400 ms、几乎每秒出现的特征**不吻合**。

## 5. 每帧 / 周期性主线程工作清单（已读）

入口：`playbackScene.js:727 animate()`（每个 rAF）。

| 工作 | 位置 | 触发条件 / 频率 | 随相机或开镜变化 |
|---|---|---|---|
| 时钟推进、`tick()`：弹道游标、击杀流、全车 `applyPose`、炮口、tracer、transient 事件泵、可破坏物更新、**履带印游标 `tread.updateTrails`**、计分、HUD | `playbackScene.js:914` | 播放中每帧 | 否；履带印仅 `treadMarks` 档（`mid` 关）；`writeHud` 内部 100 ms 节流写 store（`HUD_INTERVAL_MS`），写 store 会触发页面壳 Vue patch |
| 悬挂 / 履带形变 `suspensionStep`（逐车：逐轮地形采样、履带链路 ~40 点逐点 `sampleHeight`、`solveChain`；链变化才重写顶点，法线偏差 >2 cm 才重算） | `vehicleRuntime.ts:628` | 每车每帧；仅 GLB 可见车 | 随可见车数；不随相机 |
| 相机：跟随位移、`driveRecorderCamera`、`zoomTick`、`controls.update()`、`clampOrbitCameraToTerrain` | `playbackScene.js:750–795` | 每帧 | 录像者模式走数据驱动路径，开镜另调 FOV |
| 标签层 `labels.updateLabels()`：投影 + 软遮挡 + 发布给 Vue 覆盖层（`PlaybackVehicleLabels3D.paint`、`getViewportHeight`） | `labelsRuntime.ts:139` | 每帧 | 随可见车数/视角（top 视角全员可见最重） |
| 基地环 `updateBases`、`battle.transients.updateNow`、`updateBattleFx` | `playbackScene.js:846` | 每帧 | 否 |
| 动态分辨率 `dynResCtl.frame` | `dynRes.ts` | 每渲染帧；调整需 45 帧窗口满 + 60 帧冷却 | 否；`mid` 仅 1 级可调；调整时 `setSize/setPixelRatio` 重建 canvas buffer |
| 地形 LOD `maybeRebuildTerrainLod`：每帧 `terrainLodState` + `terrainLodStale`；满足视距 ≥+40% / ≤−5%、侧向绕转 ≥5% 视距、FOV/aspect 变化，且距上次 ≥120 ms，才 `buildTerrainGeometry`（含四叉遍历）+ `constrainFreeCameraAltitude` + 标注重投影 | `mapWorld.ts:790`、`terrainMesh.js:158` | 每帧检查，满足条件最多 8.3 次/s 重建 | **随相机**；固定/跟随下几乎不重建；拖拽/缩放期间可能连续重建（本次未能复现） |
| `renderer.render` | `playbackScene.js:858` | 每渲染帧 | 否 |
| 装甲高亮 `renderArmorHighlight`：守卫 `armorhl && recorder && scoped && !blend`；之后 `highlightEnemies()` + `aimedVehicle()`（按距离排序后对候选车逐 mesh `raycast`）+ 配置解析；命中且未被 block 才 `armorHighlight.render()`（state / thickness / occluder depth / color 共 4 个 pass，RT 64 px 取整，收缩滞回 90 帧后释放；`drawOccluderDepth` 遍历地形+场景+全部车辆） | `cameraRuntime.ts:1087`、`armorHighlight.ts:743` | **仅录像者开镜**，之后每帧；命中目标时才有额外 4 pass | 随开镜/准星；进入开镜时 `prewarm`（`renderer.compile`） |
| 几何/纹理上传 | three 内部，首次渲染/变化时 | 首帧、LOD 重建后新几何首次绘制 | 随地形重建 |
| 性能看门狗（`?perf`） | `perfProbe.ts:111` | 50 ms `setInterval` | 仅 `?perf` |

Worker 现状（已读）：见 §1.2，解析在 Worker；场景运行时、地形构建、标签与 HUD 全在主线程。

## 6. Hotspot 候选（按证据强度排序）

| # | 候选 | 证据 | 标注 |
|---|---|---|---|
| 1 | 标签覆盖层 DOM / Vue patch（`updateLabels`、`PlaybackVehicleLabels3D.paint`、`measureDamageLayout`）及强制布局 `getViewportHeight`（`playbackScene.js:502`） | 6× 节流 Profiler：标签类 13%、Vue 21–25%、`(program)` 30–36%；长帧窗口前列；长任务数随「可见车数/视角」显著变化（top 113、录像者 17、follow 1） | **已复现**（桌面 Chrome 6×，非 GeckoView） |
| 2 | `(program)` 浏览器内部工作（样式重算/布局/绘制/合成提交；其中含 WebGL 提交与 canvas） | 占采样 30–36%，调用栈无 JS 名字，具体子类未细分 | **已复现**（占比）；构成**未能验证** |
| 3 | `writeHud` 触发的页面壳 Vue patch（100 ms 一次，整个名册/顶栏） | Vue `get/set/patchElement/setFullProps` 合计约 20% | **仅静态推断 + 部分复现**（Vue 开销已测，但与 `writeHud` 的归因关系未做单点验证） |
| 0 | **地形 LOD 重建（`buildAdaptiveTerrain`，经 `maybeRebuildTerrainLod`）** | GeckoView 模拟器：录像者视角 Profiler 占非空闲主线程 50%（8850/17666 ms）、follow 37%；每次重建同帧 `cpuFrameMs` 200–570 ms（录像者 plain p50 296 / p95 492 / max 568）；>100 ms 帧与重建帧 1:1 对应（见 §10.4–10.5）。桌面 Chrome 同回放同视口 0 次重建 | **已测（模拟器）**；桌面**未复现**；真机**未能验证**；触发判据**未能读出** |
| 4 | 地形 LOD 重建（桌面 Chrome 侧，原 `buildTerrainGeometry` 表述） | 桌面所有场景重建计数 = 0 | 桌面**未能触发**（与上行互补；真实触发原因见 §10.6） |
| 5 | 装甲高亮拾取与 4 个 pass | 守卫通过但 `author.tankData` 疑似缺失，`highlightEnemies/aimedVehicle` 未被调用，`armorCalls=0` | **未能验证** |
| 6 | 悬挂/履带形变（逐车逐帧） | `tickMs` 6× 下 p50 ≈ 1.1 ms，非长帧主因；长帧窗口无其栈 | 已测为小项 |
| 7 | GC | Profiler 中 `(garbage collector)` ≤0.8% | 已测为小项（桌面） |
| 8 | 动态分辨率状态机 | 桌面 DPR 恒 1，未触发；理论上只有一级可调 | **未能验证**（真机上开关/状态未知） |

## 7. 与真机特征的吻合 / 不吻合

吻合：
- 主线程为瓶颈而非 GPU（桌面 GPU 0.4 ms；真机 GPU 占用低频，FPS 与主线程占用不相关）。
- 视角/可见车越多，长任务越多（top 视角最差）——可对应真机「帧率在数秒周期内反复切换」中视角/可见对象变化，但未与真机对上。
- 阶段时间显示长帧大头在 `animate()` 之外（DOM/浏览器内部）。

吻合（GeckoView 模拟器，§10）：
- 长帧量级：模拟器录像者 p95 300 / p99 450 ms，与真机每秒最大帧中位 225 ms 同量级；长帧 100% 对应地形重建帧。
- 与视角有关：固定视角无长帧，follow/录像者有（真机视角未知，未对上）。

不吻合（GeckoView 模拟器）：
- 模拟器 top 视角 20 fps 稳定、无长帧，不是真机「个位数 ↔ ≥100 FPS 周期切换」；模拟器没有重现 CSV 里的 GPU/CPU 小核/温控特征。
- 桌面 6× 节流下的 ≥400 ms 单帧（follow 646 ms、录像者 410 ms，各 1 个）未单独分析，不是重建（计数 0）。

不吻合（桌面）：
- 桌面最坏单帧 153 ms 且 6× 节流下也没有 ≥200 ms；真机每秒最大帧中位 225 ms、最大 409 ms。
- 桌面长任务 ≤130 ms 且集中在 top/free，录像者/follow 很少；真机特征与视角关系未知。
- 桌面没有出现「≥100 FPS ↔ 个位数」的周期切换；桌面帧间隔分布平滑。
- 桌面 GPU 占用极低；真机 GPU 44%、DPR/分辨率更高（约 3.5× 像素）。
- Chrome 不是 GeckoView：Gecko 的 JS JIT、DOM/样式/布局代价、WebRender/WebGL 管线（CanvasRenderer 线程）都不同；CPU 节流只是对 JS 与布局的粗略放大，不模拟小核/中核调度、内存带宽、温控（真机 84–96 ℃）。

## 8. 没做成的项与原因

| 项 | 状态 | 原因 |
|---|---|---|
| 每场景 ≥3 次重复 / 重复间极差 | 未做 | 时间预算；所有数值是单次运行，不能据此声明小幅差异 |
| 装甲 pass 实测（开镜 + 准星命中 + `armorhl=0/1`） | **未能验证** | 三个夹具都有开镜（`fovFromZoomRaw` 在 random 回放 59–116 s 等多段、cw 与 tournament 回放同样有）；但 `armorCalls` 全程 0。调用计数显示守卫已通过，而 `highlightEnemies/aimedVehicle/armorHighlightBlock` 未被调用，推断为 `author?.tankData` 为空（原因未查明；可能与资产/数据版本有关）。需要的观测点：`renderArmorHighlight` 提前返回的原因（`author.tankData` 缺失 / `aimDir` 空 / `blocked`）。需要的回放：录像者自身车辆的 tank 数据能在本环境资产中加载、且开镜时准星落在敌车上的回放，并保证 `author_shell_timeline` 有数据 |
| 地形 LOD 重建 | **未能复现** | 拖拽/滚轮已送达控件，但重建计数仍为 0，相机位姿是否改变未验证；需要可直接读取相机位姿的观测点 |
| Android 模拟器 | **已做**（§10） | 经 Marionette + Gecko Profiler 抓主线程栈（无需桌面 Firefox）；剩余缺口见 §10.7 |
| 真机 GPU/WebRender 路径确认 | **未能验证**（真机）；模拟器已读 gfx info | 真机无 `about:support`；模拟器 WebGL 渲染器串被打码，见 §10.3 |
| `identity.assetIdentity` / `identityComplete` | 观测缺口 | 恒 null / false（与 plan Evidence 一致），本次运行均不是「身份完整」 |
| CPU Profiler 长帧逐帧对齐 | 部分 | 时间基准用 `performance.now()` 对齐 Profiler 起点，误差为毫秒级；只做了 3 个场景 × 25 s，且 Profiler 本身有开销 |
| 节流下 `longtask` 与长帧的逐点配对 | 未做 | 只做了分布与窗口汇总 |

## 9. 需要设计阶段决定的问题

0. （新）地形 LOD 重建在 GeckoView 模拟器是长帧主因、桌面不触发：下一步是否先在真机/模拟器上读出触发判据（相机位姿、aspect、侧向位移）与单次重建耗时，再决定是否值得深入？（本报告不提方案）
1. 是否需要在 Android debug 构建里补一个能直接导出 `__pbPerf` / UNMASKED renderer / `about:support` 摘要的入口，或者要求用户用现有 debug APK + Firefox 采样，以解决「真机硬件路径」与「真机主线程归因」两个未能验证项？
2. 装甲高亮在本环境不执行的根因需要先确认（`author.tankData` 缺失？）——是否用一个已知可执行该路径的资产环境/回放重测 `armorhl=0/1`？还是先把「`renderArmorHighlight` 提前返回原因」作为观测点补进 `?perf`？
3. 是否需要向反馈者索要回放、视角、画质、`armorhl`、dynres 开关，以便按其场景复现（尤其 top/free 视角下标签层是否是主因）？
4. 桌面节流无法复现 200–400 ms 长帧：下一步优先「GeckoView 上抓栈」，还是把桌面 6× 节流扩展到带标签/HUD 全开的 top 视角并加入多次重复？
5. 标签覆盖层与 `getViewportHeight` 强制布局是否值得作为独立的验证目标（例如在真机上用 Firefox Profiler 验证是否占主线程大头），还是先等真机栈？
6. 后续测量是否把 `identity.gpuRenderer` 改为同时记录 UNMASKED（计划已把它列为可恢复的小改），以及是否记录实际 DPR/视口，保证跨设备可比？

## 10. GeckoView 模拟器结果

### 10.1 环境与身份（已测）

| 项 | 值 |
|---|---|
| 设备 | Android 模拟器 AVD `Pixel_3a_API_34_extension_level_7_x86_64`（x86_64，Android 14），宿主 Windows 11；宿主内存紧张（模拟器 ~4 GB，宿主空闲 <1 GB） |
| 引擎 | GeckoView 158（Firefox 158.0），debug APK `com.wotbtools.app` v5.1.0，`remoteDebuggingEnabled=BuildConfig.DEBUG` |
| 页面 bundle | `__pbPerf.snapshot().identity`：`buildCommit=2df9d51a2`（PR #943 合并点，2026-11-10 23:16 +01:00）、`wasmCommit=97ce7b55…`、`wasmRelease=v0.4.23`。它是当前 HEAD（`6235e1e97`）的祖先、落后 34 个提交；这 34 个提交里 `frontend/src/scene/` 只改了 `assetBase.ts`（+测试），回放渲染/地形/标签代码与当前一致（`git diff --stat`）。**未重建 APK**（不需要）。 |
| 采集通道 | `am set-debug-app` + `/data/local/tmp/<pkg>-geckoview-config.yaml`（`--marionette --remote-allow-system-access`），经 `adb forward` 连 Marionette(2828)，chrome 上下文调 `Services.profiler.*`；页面读取 `window.wrappedJSObject.__pbPerf`（Marionette 沙箱看不到页面全局，必须走 `wrappedJSObject`） |
| 回放 | 应用内置官方示例回放（`championship-maus-example`，不是桌面用的三个夹具）；`?view=replay&perf&q=mid&dynres=0&armorhl=0`；横屏 CSS 视口 693×346（`identity.viewport`），`dpr=1.25`（`mid` 档上限） |
| 方法 | 每场景 30 s，起点约 40 s：`top`=固定、`follow`=点名册首行、`rec`=录像者。**每场景 2 次**：plain（只测 rAF 间隔 + `__pbPerf`）、profiled（Gecko Profiler `js` feature，线程 GeckoMain/Compositor/Renderer/CanvasRenderer/DOM Worker）。profiled 运行本身拖慢页面，**只用来看构成占比**，帧间隔以 plain 为准。每格单次，无重复，没有极差。 |

### 10.2 每场景帧间隔（rAF 外部采样 + `__pbPerf`，已测）

单位 ms；`cpu` 为 `__pbPerf` 每帧 `cpuFrameMs` 的 p50/p95/max；"重建"为窗口内 `terrainRebuilds` 增量。

| 场景 | 运行 | 帧数 | p50 | p95 | p99 | max | >33 | >50 | >100 | >200 | >400 | 重建 | cpu p50/p95/max | 游戏时间 s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| top 固定 | plain | 596 | 50 | 67 | 83 | 100 | 507 | 87 | 0 | 0 | 0 | 0 | 44/49/89 | 48–78 |
| top 固定 | prof | 296 | 67 | 267 | 300 | 350 | 296 | 237 | 76 | 34 | 0 | 0 | 17/62/160 | 48–71 |
| follow | plain | 306 | 33 | 50 | 2050 | 2083 | 20 | 13 | 10 | 10 | 10 | 11 | 21/38/2089 | 41–51 |
| follow | prof | 744 | 33 | 67 | 233 | 350 | 204 | 45 | 11 | 9 | 0 | 12 | 4/10/342 | 44–72 |
| 录像者 | plain | 405 | 50 | 300 | 450 | 583 | 252 | 126 | 39 | 37 | 8 | 37 | 11/292/568 | 45–66 |
| 录像者 | prof | 525 | 33 | 233 | 283 | 400 | 245 | 80 | 40 | 40 | 0 | 41 | 11/225/370 | 46–69 |

读数要点：
- **top**：约 20 fps 的稳定慢帧（p50 50 ms），**没有长帧**，cpu 44 ms 几乎全是 `render`（`renderMs` p50 42 ms）。
- **follow / 录像者**：平时 3–20 ms，长帧全部成对出现在重建帧。逐帧对应（`__pbPerf.terrainRebuilds` 差分）：>100 ms 的 cpu 帧 follow plain 11 个、其中 11 个有重建；follow prof 12/12；录像者 plain 37/37；prof 41/41；top 0/0。
- 重建帧 cpu：录像者 plain p50 296 / p95 492 / max 568；prof p50 236 / p95 300 / max 370；follow prof p50 268 / p95 335 / max 342；非重建帧 p50 10–11、p95 18–25 ms。
- **follow plain 的 ~2 s 重建（11 次 × 约 2036 ms）是离群**：同一代码路径在 prof 运行里只要 ~268 ms。该次运行时宿主内存/CPU 紧张，原因**未验证**，不要把 2 s 当典型值。
- 有重建的场景里，游戏时间推进变慢（follow plain 30 s 只走了约 10 s 游戏时间），说明重建拖慢了整个回放节奏。
- 与真机 CSV 的量级对比：真机每秒最大帧中位 225 ms、最大 409 ms；模拟器录像者 p95 300 / p99 450 / max 583 ms，**量级一致**，但这是不同设备上的两个独立观察，不是同一现象的证明。

### 10.3 图形路径（已测 + 未能验证）

`Cc["@mozilla.org/gfx/info;1"]`（chrome 上下文）读到：

- 适配器：`Google (NVIDIA Corporation) -- Android Emulator OpenGL ES Translator (NVIDIA GeForce RTX 3060 Laptop GPU/PCIe/SSE2) -- OpenGL ES 3.1 (4.5.0 NVIDIA 592.82)`，即 **宿主真 GPU 经模拟器 GL 转译**，不是 CPU 软渲染。
- `features`：`compositor=webrender`、`hwCompositing=available`、`webrender=available`、`gpuProcess=available`、`openglCompositing=available`；`wrCompositor` 为 `disabled:FEATURE_FAILURE_DISABLED`。
- 偏好：`gfx.webrender.software=false`、`gfx.webrender.all=false`、`webgl.disabled=false`、`webgl.force-enabled=false`、`gfx.canvas.accelerated=true`、`layers.acceleration.disabled=false`。`AzureCanvasBackend/ContentBackend=skia`。
- 页面侧 `getContext('webgl2')` 成功，`gl.RENDERER` 与 `WEBGL_debug_renderer_info` 的 `UNMASKED_RENDERER_WEBGL` **都是 `Generic Renderer`**（Gecko 隐私打码）→ **WebGL 实际渲染器串未能直接读出**。结合上面的 gfx info，**未发现软件渲染证据**，但这是「没发现」，不是「读出了硬件串」。
- 所以：**没有「WebGL 走软件」这一最糟情形的证据**；模拟器上的 GL 调用要穿过转译层，会把 `render` 的 CPU 时间放大（见 10.4），不能代表真机驱动。

### 10.4 主线程栈构成（Gecko Profiler，已测；与桌面 §4.2 同口径但分类不同）

Profile：内容进程 `GeckoMain`，每场景 ~30 s，原始文件 `scratch/out/gv_<场景>_prof.profile.json`；汇总 `scratch/gv-profile-summary.txt`，脚本 `scratch/gvprof2.py`。占比 = 非空闲采样时间（去掉 `nsAppShell::ProcessNextNativeEvent:Wait` 与 Marionette 采集自身），以相邻采样时间间隔加权。profiler 把采样间隔拉到 ~11 ms，且 profiled 运行自身变慢，占比可靠度低于 plain 的帧间隔。

| 构成（按栈归类，优先级自上而下） | top | follow | 录像者 |
|---|---|---|---|
| **地形 LOD 重建**（栈含 `tc`=`buildAdaptiveTerrain`，经 `re`←`J`←`maybeRebuildTerrainLod`） | 0% | **37.4%** | **50.1%** |
| three.js `render`（`XM.render` → `renderBufferDirect` 等 GL 提交） | **48.5%** | 22.7% | 27.2% |
| 浏览器绘制/合成（Paint / DisplayList / WebRender） | 17.0% | 13.0% | 8.2% |
| Vue/应用 JS（`main`/`router`/`Replay3DPane` chunk，含 HUD `writeHud` 触发的页面壳补丁） | 16.8% | 6.3% | 5.0% |
| `animate()` 其余（`tick` `pe`、标签 `O`/`g`、特效 `_` 等） | 8.4% | 11.5% | 5.9% |
| 其他原生 / IPC | 4.7% | 6.2% | 2.1% |
| GC / CC | 2.3% | 1.5% | 0.6% |
| 样式 / 布局（含 `getViewportHeight` 强制布局） | 1.5% | 0.8% | 0.7% |
| 其他 JS | 0.7% | 0.7% | 0.1% |
| 非空闲占比（该次采样窗口内主线程忙的比例） | 37.9% | 29.6% | 58.2% |

函数对应关系（压缩后名字 → 源码，经页面 `useSceneActivity-*.js` 的行列定位）：`bn`=`animate()`；`O`=标签投影更新（`getLabelOverlay`）；`g`=标签 DOM 刷新；`pe`=逐帧推进（`advanceShotsTo`/`applyPose` 等）；`_`=特效帧（调用 `getViewportHeight`=`e.clientHeight`）；`J`/`re`=`maybeRebuildTerrainLod`；`tc`=`buildAdaptiveTerrain` 入口，`Zl` 为四叉遍历，`oe/ye/me/xe` 为内部高度/误差辅助。

与桌面 Chrome 结论（§4.2：标签 DOM 层 + Vue + 强制布局 + `(program)`）的对照：
- **top**：GeckoView 上最大头是 `render`（48%）而不是标签层；标签相关（`O`/`g`）和强制布局（`getViewportHeight`，约 128 ms/30 s）占比很小（样式/布局合计 1.5%）。**桌面「标签/DOM」结论在 GeckoView 模拟器的 top 视角下没有重现为主因**；但模拟器 `render` 被 GL 转译放大，不能据此说真机也是 `render` 为主。
- **follow / 录像者**：地形重建压倒其他项，桌面 Chrome 在这两个视角里重建计数为 0，所以桌面从未看到这个栈。
- Vue/页面壳补丁在 top 里 16.8%（桌面 6× 为 21–25%），量级相近。

### 10.5 重建帧的时间构成（已测）

- 重建栈（录像者 prof，8850 ms）内部：`Zl`（四叉遍历）5774 ms，其中 `oe` 2712、`ye` 1234、`me` 1153、`J` 内部 842、`xe` 840 ms。重建是**纯 JS 同步计算**，发生在 `animate()` 内、`render` 之前，直接把该帧拉长。
- 重建后是否有额外的几何上传/首次绘制代价：栈里 `render` 占比同步偏高，但本次**未做单帧拆分，未能验证**。
- `terrainCheckInclusiveMs`（`__pbPerf`）在重建帧 p50：录像者 plain 262 ms、follow prof 250 ms，与 `cpuFrameMs` 相符；非重建帧此项可忽略。

### 10.6 为什么桌面不重建而模拟器重建（部分已测，其余未能验证）

- **已测**：桌面 Chrome 打开**同一个示例回放**，视口 678×298、DPR 1.25、`q=mid`，follow（游戏时间 66–96 s）、录像者（46–76 s）、固定（46–76 s），1× 与 6× 节流（follow、录像者）全部 `terrainRebuilds` 增量 = 0（`scratch/out/ex_example_*.json`，日志 `scratch/ex_run*.log`）。1× 帧间隔 p50 6.9 ms，cpu p50 ≈ 1 ms。6× 下 follow p99 90 ms、录像者 p99 153 ms，仍没有重建。这些桌面原始帧间隔里单个 ~270 ms 的 max 出现在所有 1× 运行的同一位置，属于 `stopCapture` 的采集边界假象（§0 早先已裁剪同类假象）。
- 所以 **不是「帧慢→重建」**：桌面在 6× 节流下一样慢但仍是 0。
- 重建判据（`terrainLodStale`，已读）：视距变化 −5% / +40%、**侧向位移 ≥ 5% 视距**、FOV 相对变化 >0.1%、aspect 相对变化 >0.1%，且距上次 ≥120 ms。模拟器上 top（相机不动）0 次，follow/录像者（相机随车移动）才有，说明与相机运动有关；但 **具体是侧向位移、FOV 还是 aspect 在每次触发，本次未能读出**（相机位姿 / aspect 没有观测点，不改源码无法取得）。
- 仅推断：Gecko 与 Chrome 在窗口/画布尺寸取整、`devicePixelRatio=1.3636`（页面报告）与 `dpr=1.25`（渲染）、或相机平滑在大 `dt` 下的轨迹上可能不同，使 aspect/侧向位移越过阈值；**没有证据，不作为结论**。
- 窗口不完全一致：模拟器录像者窗口为游戏时间 45–66 s、桌面为 46–76 s，重叠但不相同；follow 窗口模拟器 41–51 s、桌面 66–96 s。

### 10.7 模拟器的局限与未做的项

局限（影响所有上面数字的解读）：
- x86_64 虚拟机 + 宿主 GPU 转译：GL 调用开销、`render` 占比与真机驱动不同；**无温控、无大小核**；宿主内存紧张可能放大个别运行（见 follow plain 离群）。
- 每格单次运行，无重复；profiled 运行自身扰动；模拟器 CPU 与真机骁龙差异大，**绝对毫秒数不能迁移到真机**，只有「哪个函数在占时间」这类定性结论有参考价值。
- 回放是官方示例，不是桌面用的夹具，也不是反馈者的回放。

没做 / 未能验证：
- **装甲高亮 pass**：未测。示例回放中录像者视角的开镜/准星命中无法确认（`reticle` 检测在示例里无命中），按 §8 的原则不用自由视角替代；`armorhl=0/1` 对比**未能验证**。
- 真机上是否也由地形重建主导：**未能验证**（需要真机 Gecko Profiler 或在真机构建里带一个重建计数/耗时观测，CSV 里没有）。
- 重建被触发的具体条件（侧向位移 / FOV / aspect）：**未能验证**。
- 多次重复与置信区间：未做。
- `gpuRenderer` 真实串：被 Gecko 打码，**未能读出**。

清理：模拟器已 `adb emu kill`，`adb forward/reverse` 已清除，`am clear-debug-app` 并删除 `/data/local/tmp/<pkg>-geckoview-config.yaml`，桌面 dev server（5190）与临时 `fx-server`（8099）已停止；除 `docs/research/testing/3d-perf-728/` 外未改仓库。

## 2026-11-23 · PR #1066 复测：地形上传归因与幽灵名牌场景

**地形上传归因（R5，诊断包，非评分）。** 资产版本 `11.21.0_1-20261114-r1`、数据集 `11.21.0_1`，回放 `random-battle-example`，follow 视角从回放时钟 66 s 起 12 s（单一原始窗口），mid、dynres=0、CPU 1×，视口 1280×720、DPR 1。采集 `scratch/out/r5random_follow-mid_x1_diagnostic_12s_r5-attrib-2_1280x720dpr1.json`（12 s 窗口）含 1673 帧、28 次相机 LOD 地形重建。`scratch/terrain-attribution.mjs` 按 `terrain-geometry` 事件的 generation 聚合逐帧上传：

| 项目 | 数值 |
|---|---:|
| 地形 generation（含加载期） | 61 |
| 与该代地形同时出现的整帧 bufferData / bufferSubData 调用 | 115 / 504 |
| 与该代地形同时出现的整帧上传字节 | 201,270,832 |
| 单代四 attribute 全量上传 | 约 7.1–7.2 MB |
| 测量窗口内重建（大上传帧） | 28 帧（1.7%） |
| `swapMs` | 0.0–0.3 ms |
| 大上传帧 vs 普通帧 p95 帧间隔 | 13.2 vs 9.7 ms |

`swapMs` 只覆盖主线程换装，不含首次上传。上表的 bufferData/bufferSubData 是 **整帧 WebGL 流量**（按地形代次归组），不等于地形自身首次上传的 owner 归属；地形换装与车辆/纹理上传在同一帧内不可再分。每代约 7.2 MB 的几何上传落在大上传帧。基此判断容量桶与稳定 BufferAttribute 仍须把 Worker 传来的完整几何复制进常驻 buffer，`bufferSubData` 仍上传全量（LOD 几何逐代变化，无可复用的小 update range），而受影响帧仅 1.7%，故本轮**只交付归因，不实现容量桶**。评分模式（`--no-perf`）不安装 perf/上传挂钩，`terrain-attribution.mjs` 对带挂钩的 score 捕获直接拒绝。

**幽灵名牌场景（R7，场景登记）。** 可用夹具在 `random-battle-example` 回放时钟 150–180 s 有持续 1–3 个幽灵名牌入镜（`scratch/scan-ghosts.mjs`，固定全图相机、mid、dynres=0；150–162 s 为 3 个，之后降为 1–2 个）。登记场景 `top-mid-ghost`：固定全图相机、q=mid、dynres=0、1× 播放、1280×720、DPR 1，使用 `--last-known=on|off` 每轮显式设置并核实开关。该场景下 30 s 单对诊断（ON 20.7 ms / OFF 13.9 ms 帧间隔 p50）受采集顺序与机器状态影响，**不作为 A/B 结论**；#1001 基线产物与平衡交错三轮 60 s 采集尚未完成，待相关运行时改动落地后按对应 thread 的验收继续。

## 附：产物位置

- 真机 CSV：`field-reports/2026-11-10-oneplus-ace-pro/`；CSV 分析脚本：`scratch/csv.py`
- 桌面原始数据（含逐帧、rAF 时间戳、longtask、Profiler）：`scratch/out/*.json`（约 33 MB，未做压缩）
- GeckoView 模拟器：`scratch/mn.mjs`（Marionette 客户端）、`gv-open.mjs`、`gv-run.mjs`（场景采集）、`gvprof2.py` / `gvprof.py`（Gecko profile 汇总）、`gv-profile-summary.txt`、`gv-t*.mjs`（探路脚本）、`mn-gfx.mjs`（gfx info）、`out/gv_*.json`（帧数据）、`out/gv_*_prof.profile.json`（原始 Gecko profile，约 7 MB × 3）、`out/useSceneActivity.js`（符号定位用的 APK 内 chunk）、`gvlog_*.log`
- 桌面同示例回放对照：`out/ex_example_*.json`、`ex_run*.log`；`lib.mjs`/`run.mjs` 为此新增了 `--fixture=example` 与 `VW/VH/VDPR`、`top-ex`/`rec-ex` 场景
- 采集/分析脚本：`scratch/lib.mjs`、`run.mjs`、`cover.mjs`、`cover2.mjs`、`orbitcheck.mjs`、`analyze.mjs`、`prof.mjs`、`dev-server.mjs`；汇总表 `scratch/summary-table.md`；长帧明细 `scratch/longframes.md`；日志 `scratch/*.log`
