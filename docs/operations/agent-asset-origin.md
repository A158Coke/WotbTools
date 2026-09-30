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

## 配置来源与优先级

`frontend/src/scene/assetBase.js`：

1. `?assets=<url>` URL 参数（开发/运维 override，非空时持久化到 localStorage）
2. `localStorage.wotb_asset_base`（单浏览器 override）
3. **生产构建默认 `VITE_ASSET_BASE_URL`**（部署注入，普通用户走这条）
4. 均未设置 → 未配置：`assetProvider` 抛错，3D 视图显示"未配置资产源"提示

`?assets=`（显式空）用于**清除 override**，回落到生产构建默认。

## 当前选择（临时）：腾讯云 COS

> **临时决定**，仅因现成可用。运行时保持中立：换成 GitHub Release 附件 / 静态服务器 /
> 其他对象存储，成本 = 改一个 Repository Variable + 重建镜像。本文件是唯一需要改的文档。
>
> 注意：COS 存在持续下行流量成本；评估其它 origin 时按下方 §3 换值即可。

### 1. 生成资产包（上游仓库）

资产包由上游 `WoT-Blitz-Agent` 生成（本仓不产出游戏资产）：

```bash
# 需游戏客户端在场（地图注册表源）
wotb-agent dump-map-index > map_index.json
python scripts/export_asset_pack.py --map-index map_index.json
# 缺省产物：release/asset_pack/（--out 用绝对路径）
```

产物布局（契约 §13；`manifest.json` 附全量 sha256）：

```
index.json                     # 数字 id → key/space/display（前端一次性装载）
glb/{tank_id}/{model,collision}.glb
tank_images/{id}.webp
data/{tanks.pb,models.pb,tank_cache.json,data_version.json}
map/{key}/{ground,mini}.webp  terrain.u16.bin  terrain.json
map/{key}/{scenery.glb,ground.layers.json,ground/*.webp}
```

### 2. 上传到 COS

用官方 CLI（凭据只存本地，**绝不进仓库**）：

```bash
pip install coscmd
coscmd config -a <SecretId> -s <SecretKey> -b <bucket> -r <region>
coscmd upload -r release/asset_pack/ /asset_pack/
```

要求：

- **读权限**：桶/前缀需允许匿名读（或经 CDN 回源）。前端按 HTTP GET 直取，无签名。
- **CORS（必做，否则 3D 资产静默失败）**：`assetProvider.bytes()` / `.json()` 走
  `fetch()`，跨域需要 CORS 响应头。允许站点源 + `GET`/`HEAD`：
  - `Access-Control-Allow-Origin: https://wotbtools.com`（或 `*`，资产为公开内容）
  - `Access-Control-Allow-Methods: GET, HEAD`

  封面图经 `<img>` 加载不需要 CORS，但 GLB / tank JSON / terrain 都走 `fetch`——
  "只配了图片可用"是常见误判：图能出、模型和地形全挂。
- **缓存**：文件名不含内容哈希。用较短 `Cache-Control` TTL，或换包时同时切换路径前缀
  （如 `/asset_pack/v3/`），否则用户会长时间命中旧包。

### 3. 注入生产 origin

仓库 **Settings → Secrets and variables → Actions → Variables** 新增（非敏感）：

```
ASSET_BASE_URL = https://<bucket>-<appid>.cos.<region>.myqcloud.com/asset_pack
```

- 必须是 `https://` 开头、**不能以 `/` 结尾**——`frontend.yml` 的
  "Validate production asset origin" 步骤 fail-closed 校验这两点，缺变量直接失败。
- 只放公开 origin，**不放任何密钥**（Repository Variable，不是 Secret）。

构建链路：`vars.ASSET_BASE_URL` → `frontend.yml` build-arg `ASSET_BASE_URL`
→ `Dockerfile.frontend` 的 `ARG`/`ENV VITE_ASSET_BASE_URL` → Vite 构建期写进 bundle。

本地构建：`VITE_ASSET_BASE_URL=... npm run build`。

### 4. 生效与验证

- **必须先设置变量再触发构建**：CI 已 fail-closed，变量缺失时 Frontend 工作流在构建前
  就失败（不会产出指向空 origin 的镜像）。
- origin 是**构建期**写入 bundle 的：改变量不会更新已部署镜像，需要新的 commit 或
  `workflow_dispatch` 手动跑一次 Frontend 工作流。
- 线上验证：打开站点 → 坦克百科 / 全场回放出图出模型；DevTools Network 里 GLB / JSON
  请求指向该 origin、状态 200（无 CORS 报错）；"未配置资产源"提示消失。

### 5. 覆盖与回滚

- 单浏览器覆盖：`https://wotbtools.com/?assets=https://other-origin/pack`
- 回到生产默认：访问 `?assets=`（显式空，清除 override）
- 回滚：把 `ASSET_BASE_URL` 改回上一个 origin 并重建镜像

## 相关

- `frontend/src/scene/assetProvider.js` —— 唯一边界（logical path → origin → bytes/JSON/URL）
- `frontend/src/scene/assetBase.js` —— origin 解析与优先级
- `frontend/src/scene/assetBase.test.js` —— 优先级与空值语义的回归测试
- 上游 `scripts/export_asset_pack.py`、`scripts/asset_manifest.py` —— 打包与清单
