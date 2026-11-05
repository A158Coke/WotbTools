# Agent 3D 静态资产源（asset origin）

> 何时查阅：部署 / 排障 Agent 3D 功能（全场回放、装甲查看器、坦克百科、射击复现）
> 的静态资产取用，或需要更换资产源（origin）时。

## 边界：运行时不绑定任何基础设施

Playback / Tank Viewer / Armor Viewer / Agent Data 的资产访问只有一条通路：

```
消费方（playbackScene / tankViewer / armorViewer / agentData / replaySource）
    |
    v
assetProvider.bytes|json|url('<logical asset path>')
    |
    v
assetBase()  ← 解析出的 asset origin
    |
    v
配置的 remote asset origin（静态服务器 / 对象存储 / CDN / 镜像皆等价）
```

消费方不含任何主机名、bucket、CDN 或 fallback 决策（`frontend/src/scene/assetProvider.js`
是唯一边界）。**更换 origin 不需要改任何消费方代码**——改部署配置并重新构建镜像即可。

基础设施选择只出现在本文件与部署配置里，不出现在应用契约中。

## 当前状态（2026-11-05 更新）

| 项 | 值 |
|---|---|
| Web origin | `https://assets.wotbtools.com` |
| 版本目录 | `https://assets.wotbtools.com/versions.json`（dataset 列表 + default）；每个游戏版本在 `/v/<dataset-id>/` 下 |
| Dataset 通道（2026-11-05） | `supertest`（超测服，随预览轮次重指到最新预览 release：t11b → t11p2 → …）/ `11.21.0`（现役）/ `11.22`（预留，正式服包发布时加入；最终三通道 = 超测服 / 11.21 / 11.22）。旧 `11.21.0-t11-preview` 通道由 `supertest` 取代（`dataset.sh unlink`） |
| 路由部署状态（2026-11-05） | 主机已完成 objects/datasets 迁移并生成 `versions.json`；生产 Caddy 仍是旧 Caddyfile，`/versions.json` 与 `/v/<id>/...` 当前返回 `404`。新 Caddyfile 已用临时容器对真实 `/srv/wotb-assets` 验证（index/version/versions/dataset 路径全 `200`），需经 `asset-origin` → Komodo Stack redeploy 后生效 |
| Web 资产包位置 | Alibaba asset host 的 `/srv/wotb-assets/current`（默认 dataset 的兼容入口）与 `/srv/wotb-assets/datasets/<id>`，由 `deploy/assets/` 的 Komodo Stack 提供 |
| Android 新版本 origin | Native `AgentAssetProxy` 直连 `https://assets.wotbtools.com`；`/agent-assets` 本机路径保持不变，`/agent-assets/v/<id>/...` 原样透传 |
| COS legacy origin | `https://wotbtools-assets-1478073677.cos.ap-shanghai.myqcloud.com`；旧 APK 与临时回滚使用，桶和对象暂不删除 |
| 包完整性 | 抽查 14 条关键路径全部 `200`（GLB / 碰撞 / tank JSON / 封面 / tanks.pb / models.pb / 底图 / 小地图 / 地形 bin / terrain.json / 场景 GLB / 地表分层 / 卷积贴图） |
| CORS | Alibaba Web origin 已验证允许 `https://wotbtools.com` 与 `https://www.wotbtools.com`，并支持浏览器 `GET,HEAD` |
| HTTP 行为 | HTTPS、Range/206、ETag/304、Content-Type 与缓存头均已验证 |
| Android | 资产基址 = 本机路径 `/agent-assets`（`ANDROID_ASSET_BASE`），新版本由 Native `LocalRuntimeServer` 路由到 `AgentAssetProxy`，使用原生 `HttpURLConnection` 直连 Alibaba 并做 ETag 磁盘缓存；不依赖 CORS，也不经过生产网关。旧 APK 可继续访问其编译时 COS origin；旧 gateway identity 的 `/agent-assets` 兼容反代保持指向 COS |
| COS 桶列举 | `/` 返回 `403`（仅列举被拒，属预期）；匿名对象读为旧 APK 与回滚保留 |
| 本地开发 | **未覆盖** `http://localhost:*`——本地 dev 直连 Alibaba origin 时 GLB/JSON 的 `fetch` 会被 CORS 拦截（见下"本地开发"） |
| Web 配置 | `.github/workflows/frontend.yml` 与 `.github/workflows/frontend-replica.yml` 将 `ASSET_BASE_URL` 固定为 `https://assets.wotbtools.com`；Frontend 校验步骤验证 HTTPS origin 格式 |

## 配置来源与优先级

`frontend/src/scene/assetBase.ts`：

1. `?assets=<url>` URL 参数（开发/运维 override，非空时持久化到 localStorage）。若它已经是
   `/v/<dataset-id>` 的完整基址，则原样使用，不再叠加 `?data=`
2. `?data=<dataset-id>` URL 参数（选择某个游戏版本 dataset，持久化到 `wotb_data_version`）
3. `localStorage.wotb_data_version`（单浏览器 dataset 选择）
4. **生产构建默认 `VITE_ASSET_BASE_URL`**（由主 Frontend 与 TX2 replica workflow 的 `ASSET_BASE_URL` 输入注入，普通用户走这条）；未选 dataset 时读 origin 根 = 服务端 `current`
5. 均未设置 → 未配置：`assetProvider` 抛错，3D 视图显示"未配置资产源"提示

`?assets=`（显式空）用于**清除 override**，回落到生产构建默认。`?data=` 为空 = 默认
dataset（删除持久化选择）。

### 数据版本（dataset）

资产面按游戏版本维护，而不是只保留一份 `current`：

```
/srv/wotb-assets/
  releases/<release-id>/          # 不可变
  datasets/<dataset-id> -> ../releases/<release-id>
  current -> datasets/<default-id>
  versions.json
```

- 前端在侧边栏顶部 logo 下方提供显式下拉选择（移动端在「更多 → 显示设置」）；切换写入 `?data=` 并整页重载
- `versions.json` 是选择器唯一数据源；`default` 对应 `current`，旧客户端继续读根路径
- 发布/回滚/目录重建由 `deploy/assets/dataset.sh` 完成（`flock` + 原子符号链接 +
  `tools/asset_release.py` 校验），详见 `deploy/assets/README.md`
- 存储去重：`objects/<sha[:2]>/<sha256>` 保存唯一内容，release 树为对象硬链接（Caddy
  静态伺服不变）；迁移/发布/gc 用 Agent 仓 `tools/asset_store.py`，见
  `docs/asset-store.md` 与 `deploy/assets/README.md`

### 数据版本覆盖范围（审计，2026-11-05）

**资产包内的运行时数据一律经 `assetProvider`（Web / Android）或 `androidAssetBase()`（Android map2d
OTA）解析**；禁止直接读 `ANDROID_ASSET_BASE` / `VITE_ASSET_BASE_URL`，也禁止手拼
`/glb|/tank|/map|/cover|/research|/tank_images|/data|/tread|/suspension` 路径。
守卫：`frontend/src/data-version-wiring.test.js` 扫描全部 `src`（含 `.vue`），
任何绕过 `assetProvider` 的字面资产路径、直接常量引用都会失败。

跟随 dataset 切换：

- `tank/{id}.json`、`data/tank_cache.json`、`data/shellKinds.json`
- `glb/{id}/*.glb`（3D 回放 / 坦克查看器 / 装甲查看器）与 `suspension/`、`tread/`
- `map/{key}/**`（scenery / terrain / ground / lighting / IBL）
- `cover/`、`tank_images/`（含 `crops.json`）
- `research/**`（配置器 / 科技树 / 模块）
- `map2d/`：Web 地图预览在显式选择 dataset 时 dataset 优先、bundled 兜底；Android OTA
  overlay 走 `/agent-assets/v/<id>/map2d/`

静态 / 随前端打包（**不属于 dataset**，切换不会改变）：

- `frontend/src/data/mapImages.js`：Web 2D 战术底图 canonical（离线 + 逐图校准）；
  BattlePlayback / MapOverview 仍用 bundled；MapPreview 在显式选 dataset 时优先 pack `map2d`
- `frontend/src/vehicle-models/assets`：Tier X dedicated hull/turret webp（演示层资产）
- `frontend/src/assets/tank-portraits`：Tier X 车型图
- `common/research/icons/**`：配置器物品/技能/弹种图标（非图标 data 随 dataset 的 `research/**`；
  图标本身随前端打包）
- `common/tankopedia-tier*.json`：回放本地计算 / HoF / 车型映射的静态参考（不是版本化坦克
  数值；运行时数值来自 `tank_cache` / `tank/{id}.json`）
- `/map-3d-local/**`：本机 2.5D 地图诊断夹具
- WASM parser pin：按 WotbTools 构建固定，与 dataset 正交

缓存与切换语义：

- 切换 = `location.assign` 整页重载；`assetProvider` / `agentData` / `replaySource` /
  `researchCatalog` 的模块级 Promise 缓存随页面重置
- Android `AgentAssetProxy` 磁盘缓存 key = 完整请求路径（含 `/v/<id>/`），不同 dataset 不串
- Android map2d localStorage 索引按 dataset 隔离（`wotb.map2d.index.v1:<id>`；未选择时保留旧键）
- map2d OTA 仍是“不降级”通道：dataset 的 map2d 旧于包内内容时不会覆盖 bundled
  （防 APK 升级后回退）；这是刻意策略

## 部署：接线

Web 与新 Android 版本当前统一使用 Alibaba origin。Web 由 tracked workflow 配置；Android publish readiness 从已验证 immutable release tag 的 `AgentAssetProxy.kt` 解析候选 origin，并由 `android_contract.py` 的 `REVIEWED_REMOTE_ASSET_ORIGINS` 做 allowlist 校验。下列步骤用于**更换生产 origin**：

1. 在 `.github/workflows/frontend.yml` 与 `.github/workflows/frontend-replica.yml` 中将 `ASSET_BASE_URL` 更新为同一公开 origin：

   ```
   ASSET_BASE_URL = https://assets.wotbtools.com
   ```

   必须 `https://` 开头且**不带结尾 `/`**；`frontend.yml` 的 "Validate production
   asset origin" 步骤 fail-closed 校验 HTTPS 与无尾斜线格式。

2. **触发一次 Frontend 工作流**（新 commit 或 `workflow_dispatch`）。资产源是构建期输入，
   已计入镜像身份：`identity = sha256(source SHA + ASSET_BASE_URL)[:12]`，tag 为
   `sha-<identity>`（沿用既有 `sha-<12 hex>` 契约）。因此**只改 `ASSET_BASE_URL` 也会
   得到新 tag、必然重建**——不会被"镜像已存在"复用而停留在旧 origin。复用检查与该镜像的
   发布校验都会按 bundle 内容自证 source SHA 与 origin 两者一致（见下"发布边界"）。

3. Android 同步更新 `AgentAssetProxy.kt` 中实际使用的远端 origin 常量、`scripts/android-release/android_contract.py` 的 `REVIEWED_REMOTE_ASSET_ORIGINS`，以及对应的 origin 解析测试；增加 Android 版本号。release readiness 必须继续从已验证 staged tag 源码解析 origin，不要在 workflow 中写死当前生产 origin。`ASSET_BASE_URL` 只包含公开 origin，**不放任何密钥**。

### 发布边界（frontend image → Tencent TCR）

Frontend 的镜像发布是四段分离、每段都有步级超时的边界，**不存在"一个 step 静默跑 60 分钟"**：

```
Build immutable frontend image          本地成镜像（push:false + load），不写 registry
Verify local frontend artifact          version.json/source SHA + 资产源 + WASM + 静态文件（推送前）
Report frontend image and layer sizes   镜像/分层/目录体积诊断
Reject stale main before publication    main 已前进则 fail-fast（不推一份注定不能 promote 的 tag）
Publish immutable image to Tencent TCR  docker push：每次 600s、最多 3 次、仅瞬态失败重试
Verify Tencent TCR digest               只证 registry 上该 immutable tag 的 digest == 本次推送的 digest
Publish latest only from current main   确认 source SHA 仍是远端 main 后 crane cp -> :latest
```

- **校验前置**：内容校验（source SHA / 资产源 / WASM / 期望静态文件）在**任何 registry
  写入之前**完成，校验对象是"即将被推送的那份字节"。WASM 一项不是"文件存在 + magic"而是
  **commit-addressed 身份核对**：从该 source commit 的 `deploy/agent/source.json` 读 `ref` 与
  `artifact.release`，再要求镜像内恰好只有 `/wasm/<ref>/`，其 `fingerprint.json` 的
  `upstream_commit` / `tag` 与之一致，且 stable `/wasm/wotb_replay_wasm.js` 不存在。发布后不再把整镜像从 TCR 拉回复检，
  只证 digest 对应关系（manifest digest 相等）；失败不留垃圾 tag。
- **有界重试**：`docker push` 对 immutable tag 是幂等的（registry 内容寻址，重试只补传上次
  未完成的 blob，不重建镜像、不重复构建）；超时或重试预算用尽即 fail closed。
- **不使用 GHA 构建缓存**（`cache-from`/`cache-to` 已移除）：`mode=max` 需要把整个 build stage
  上传到 GitHub cache，是与镜像同量级、且在 step 内无法单独设超时的边界；`mode=min` 不缓存
  build stage、省不下 `pnpm install`，却被同一失败面支配。该决策**只适用于 frontend**，不外推到
  business-api / keycloak / ai-service。

### 验证（不需要凭据——公开读）

```bash
B=https://assets.wotbtools.com
curl -sI "$B/index.json" | head -1                                  # 期望 200
curl -sI "$B/data/tank_cache.json" -H "Origin: https://wotbtools.com" \
  | grep -i access-control-allow-origin                             # 期望回该 origin
```

线上：打开站点 → 坦克百科 / 全场回放出图出模型；DevTools Network 中 GLB / JSON 请求
指向该 origin 且为 200、无 CORS 报错；"未配置资产源"提示消失。

## 发布：生成与上传资产包

资产包由上游 `WoT-Blitz-Agent` 生成（本仓不产出游戏资产）：

```bash
# 需游戏客户端在场（地图注册表源）
wotb-agent dump-map-index > map_index.json
python scripts/export_asset_pack.py --map-index map_index.json   # 产物 release/asset_pack/
```

产物布局（契约 §13；`manifest.json` 附全量 sha256）：

```
index.json                     # 数字 id → key/space/display（前端一次性装载）
glb/{tank_id}/{model,collision}.glb
tank_images/{id}.webp
data/{tanks.pb,models.pb,tank_cache.json,data_version.json}
map/{key}/{ground,mini}.webp  terrain.u16.bin  terrain.json
map/{key}/{scenery.glb,ground.layers.json}  map/{key}/ground/*.webp
```

为维持旧 Android 客户端与回滚能力，资产包仍同步上传到 COS **桶根目录**（旧 APK 的 `AgentAssetProxy` 继续从此读取；新版本使用 Alibaba）：

```bash
pip install coscmd
coscmd config -a "$COS_SECRET_ID" -s "$COS_SECRET_KEY" \
              -b wotbtools-assets-1478073677 -r ap-shanghai
coscmd upload -r release/asset_pack/ /
```

要求：

- **COS 读权限**：为旧 Android 客户端与临时回滚保留匿名读。新 Android `AgentAssetProxy` 和 Web 生产构建均从 Alibaba origin 匿名读取。
- **CORS（Web 端必需）**：`assetProvider.bytes()` / `.json()` 走 `fetch()`，跨域需要 CORS
  响应头。Alibaba Web origin 允许 `wotbtools.com` 与 `www.wotbtools.com` + `GET`/`HEAD`。
  封面图经 `<img>` 加载不需要 CORS，但 GLB / tank JSON / terrain 都走 `fetch`——
  "只配了图片可用"是常见误判：封面能出、模型和地形全挂。
  把站点换到新域名/新端口时，**必须同步加 CORS 规则**。
  Android 不受此约束：请求经 `AgentAssetProxy` 在原生层发起（CORS 是浏览器机制），
  因此桶白名单**不需要**也不应放行 App 本机 origin（3.0 起 `http://127.0.0.1:21653`，2.x 为 `appassets.androidplatform.net`）。
- **缓存**：文件名不含内容哈希。用较短 `Cache-Control` TTL，或换包时切换路径前缀
  （如 `/v3/`），否则用户会长时间命中旧包。Android 侧由 `AgentAssetProxy` 的
  ETag 条件请求 + 本机缓存自管，不依赖对象缓存元数据。

### 本地开发

CORS 未覆盖 `http://localhost:*`，本地 dev 直连该 origin 时 GLB/JSON 会被拦。两种做法：

- 用本地镜像：把包放本地静态目录，`VITE_ASSET_BASE_URL`（或 `?assets=`）指向它；
- 或给桶加一条 localhost 的 CORS 规则（仅开发便利，注意不要放宽到不可信源）。

## 凭据与安全

**前端与 CI 都不需要桶凭据**：`ASSET_BASE_URL` 是公开 origin，浏览器匿名 GET。
上传凭据只用于**发布侧**（生成包 → 上传），不属于运行时链路。

- **绝不提交凭据进仓库**：本仓是公开仓库，提交即等于泄露。凭据也不要写进 Issue /
  PR 正文或评论——只走本地环境变量或密码管理器。
- 交付/轮换走**安全渠道**（企业 IM 私聊、密码管理器），不要发到公开群、工单或聊天窗口。
- 当前发布凭据归属子账号 `100053279232`（`wotbtools-asset-publisher`），权限为**该桶整桶
  读 + 写（含上传、分块上传、删除）**——含删除，属较高权限，仅限可信范围使用。
- 该密钥可能同时被既有发布流水线使用：**禁用或轮换会同时影响对方与原有业务**，
  需提前约定更换窗口。
- 上传脚本从环境变量读取凭据（`COS_SECRET_ID` / `COS_SECRET_KEY`），不落盘、不入库。

## 覆盖与回滚

- 单浏览器覆盖：`https://wotbtools.com/?assets=https://other-origin/`
- 回到生产默认：访问 `?assets=`（显式空，清除 override）
- 回滚：Web 将主 Frontend 与 TX2 replica workflow 的 `ASSET_BASE_URL` 改回上一个 origin 并重建镜像；Android 如需回滚，改 `REMOTE_ASSET_BASE` 并按 Android 版本规则发布新 APK。旧 APK 仍使用编译时的 COS origin，旧镜像 tag 与 COS 对象保留。

## 未来更换 origin

> Web 与新 Android release 当前均使用 Alibaba asset origin；COS 仅保留给旧 APK 与临时回滚。更换 origin 时同步更新两份 Frontend workflow、Android Native 远端 origin 常量、`android_contract.py` 的 `REVIEWED_REMOTE_ASSET_ORIGINS` allowlist、对应解析测试及本文件。Android readiness 会从 immutable staged candidate 源码取值，workflow probe 保持动态，不复制当前 origin；保留旧客户端兼容，直至明确结束退役窗口。

## 相关

- `frontend/src/scene/assetProvider.js` —— 唯一边界（logical path → origin → bytes/JSON/URL）
- `frontend/src/scene/assetBase.ts` —— origin 解析与优先级
- `frontend/src/scene/assetBase.test.js` —— 优先级与空值语义的回归测试
- 上游 `scripts/export_asset_pack.py`、`scripts/asset_manifest.py` —— 打包与清单
