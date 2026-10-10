# 新手引导与官方示例

新手引导直接叠在真实网站上。APK 也提供首页导航以便匿名用户找到教程，但默认回放入口和外部文件导入保持。页面、回放解析、播放时钟、相机与射击检视都使用原功能；教程不拥有第二份回放会话。

## 使用方式

- 首次发布后，新老登录用户在首页或空回放工作台收到一次邀请。匿名用户只在首页看到显眼的“新手教程”按钮，点击后进入，不自动弹出或在其他页面提醒。正在导入、解析、全屏或操作其他弹窗时不抢占交互。具体能力深链保持原目标。
- 主线为 7 个节点：官方示例、数据与导出、2D 播放、绘图标记、一键防遮、3D、射击检视与复现。操作可尝试，也可直接下一步；加载时间不计入短教学的阅读时间。
- 回放教程只使用官方示例，不提供“使用当前回放”入口。第一步说明示例已打开与教学期间的范围，仍高亮示例按钮；点该按钮或“下一步”进入数据介绍。已有文件时先确认替换，取消保留原数据。完成或跳过后可使用自己的回放。
- 关闭、Escape 或跳过会记为本代已跳过；完成也会记住。刷新中断不冒充完成，仍能从帮助重开。
- 登录用户可从工作台帮助与更多中的使用指南打开完整目录；匿名用户仅从首页新手教程进入，教学完成后也可继续打开功能目录。数据、2D、标记、防遮、3D、射击、AI、百科/装甲、名人堂、积分榜与账号设置各有按需引导。
- 引导不自动生成 AI 报告、导出下载或提交成绩。3D 的画质与开始、逐发检视的打开动作仍由用户操作。

## 示例与权限

`common/assets/onboarding/manifest.json` 与对应回放是正式公开资源。当前样本是经用户授权公开的海拉斯随机战；测试夹具不整体打包。

选择示例后，数据、2D、3D 与射击分析/复现长期匿名可用，退出教学后仍可探索。3D 与装甲模型继续依赖正常联网、资产与 WebGL 条件。用户文件的数据/2D 继续匿名可用，3D/射击与 AI 保持登录要求。

`frontend/src/replay-local/demo.ts` 只加载 build 内固定路径，校验大小和 SHA-256，登记实际 File 身份。`useReplaySession` 同时持有选择来源；普通重选、追加文件、清空和 Android 文件导入撤销示例资格。URL 参数、文件名、localStorage 或教程开关都不授予权限。AI 与服务端写接口不因示例放行。

示例复用原本机分析与 `useReplayWorkspace.playbackSession`。重复点击已就绪的示例不重新选文件、不重复解析；失败可复用同一文件重试。已有用户文件时使用现有确认框明确替换，取消保持原数据。

清单中的教学 cue 由当前 pin 的真实 WASM 核验。`playbackSeconds` 是 canonical 战斗相对时间；`shotId` 是真实 `shot_id`，不能用归一化后的列表 index 替代。测试核验两者与实际样本一致。

## 更新教学

教学定义与 `ONBOARDING_RELEASE` 位于 `frontend/src/composables/useOnboarding.ts`，所有文案在三语 feature messages 中。组件的稳定 `data-tour` 锚点与 typed public surface 连接真实功能。

1. 页面移动或换行：保持锚点 id，聚焦位置由真实 DOM 重测。
2. 更新文案或加入普通功能：同步三语与专项步骤，增加 `contentRevision`，保持 `coreEpoch`。
3. 核心使用流程大改、老用户需要重学：显式增加 `coreEpoch`，新一代邀请仍可跳过。
4. 替换公开示例：替换 versioned 文件，更新 manifest 路径、大小、哈希与真实 cue，运行样本测试。不能把新文件留在旧清单身份下。
5. 关闭自动邀请：将 `ONBOARDING_RELEASE.enabled` 置 false；普通回放仍可使用。

页面位置可以自动跟随；功能意义和说明文字需要维护。build commit 或 package version 不决定是否重新邀请。在线旧 tab 不会被远程强制打断，APK 通过正常 bundled frontend 更新获得新版教学。

## 完成记录

本机长期缓存只使用 `wotbtools-onboarding`，按匿名/当前 JWT subject 区分记录。`OFFERED` 表示已邀请或中断，保存当前主线节点供继续；`COMPLETED/SKIPPED` 是终态。匿名无痕、清存储或换设备不能永久识别；存储不可用时至少保留本页面会话抑制。

登录账号经既有 profile bootstrap 成功后读取/保存 `GET/PUT /api/users/onboarding`。接口只认 JWT subject，返回 `{ coreEpoch, disposition }`，初始为 `0/NONE`。PUT 只接受正 epoch 与 `COMPLETED/SKIPPED`。最大 epoch 优先，同代完成优先，重复写入幂等；不记录逐步行为或用户回放信息。

后端在 `user_profile` 存两列，随资料删除而删除；既有 row lock 保证合并，动态 dirty-column 更新防止迟到的其他资料保存覆盖回执。OpenAPI 是 wire authority，types/validators 由原生成入口产出。

查询结果未知时不自动判为首次用户；同步失败不阻塞本机功能或手动指南。离线先记本机，恢复可用且身份稳定后同步；账号切换和迟到响应按 auth generation 隔离。明确登录前同步写入一次性、30 分钟到期的 sessionStorage 交接标记，使浏览器重定向返回后也可迁移匿名终态；匿名缓存记录本代迁移已消费，不能继续复制给第二个账号。

## 交互与验证

`OnboardingHost` 只消费教学 owner。轻量遮罩保留地图、车辆和阵营颜色（深色主题 18%、浅色主题 12%，不做全屏灰度滤镜），真实目标仍可点击，短卡在桌面就近定位、手机靠下，窗口滚动/旋转/缩放时重测；在当前 fullscreen element 内呈现。导航按钮在稳定的安全位置，全屏时避开底部播放控件；跨功能前通过明确的“退出全屏并继续/返回”动作离开原容器。焦点范围包含教学卡和实际目标/所需模态面，退出恢复焦点、清理监听与临时教学面板。

验证入口沿用 Vitest、typecheck、stylelint、`test:browser-interaction` 与 `test:browser-layout`。关键回归是邀请版本、终态合并、File provenance 撤销、取消/选文件竞态、真实 hit target、焦点与几何、shots→armor→返回。真实 GPU 画面与新手试走由用户核验，不以 Agent 截图充当 3D 验收。

发布需先上线新增数据库迁移与账号资源，再发布前端。回滚前端可保留 additive 数据列，不能撤销已应用 Flyway。示例资格与普通回放登录策略独立。
