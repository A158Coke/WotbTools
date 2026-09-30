# 退役 AI-HD 地图执行计划

用户已通过调用 plan-executer 批准所附方案。复用同主题 worktree，起点为最新 origin/main 02e8a3b6；保留完成记录。

| 步骤 | 状态 |
|---|---|
| 原始地图覆盖、尺寸、映射与坐标契约审计 | 完成 |
| 删除 derivative/tooling，切换 2D imports 与测试 | 完成 |
| canonical docs 同步 | 完成 |
| build、浏览器验证与 CI 容量基线 | 本地验证完成；CI 待运行 |
| review-fix / review-with-docs / code-smell 与 PR | 审查完成；提交开 PR |
| 合并后生产 workflow 与 TCR 观察 | 待合并后执行 |

范围：仅 2D basemap 资产与对应验证、文档；3D AssetProvider/COS/manifest/模型保持现有契约。风险：intrinsic pixels 与逻辑渲染尺寸不同，必须保留逻辑坐标框。验证：地图 targeted suite、browser-layout、Vite build；生产 Docker build 和完整前端验证由 PR CI 执行。回滚：revert 本原子迁移提交，无数据迁移。

## 用户批准的原始方案

实施方案：退役 AI-HD 地图，统一 2D Local / 3D Remote
目标架构
最终边界固定为：
                         WotBTools Frontend
                                │
              ┌─────────────────┴─────────────────┐
              │                                   │
         2D Map Assets                       3D Assets
              │                                   │
      bundled with frontend                 AssetProvider
              │                                   │
frontend/src/assets/maps/              VITE_ASSET_BASE_URL
              │                                   │
       Vite → Docker                         Tencent COS
                                                  │
                                        runtime on-demand

原则：
2D = local
3D = remote

2D 只保留游戏客户端解包得到的地图图片。不再维护 AI upscale / HD derivative。
Scope
1. 删除整套 maps-hd
删除：
frontend/src/assets/maps-hd/**

包括：
maps-hd/*.webp
maps-hd/manifest.json

当前 manifest 明确描述的是：
maps/*.webp
   ↓
REAL_ESRGAN_GENERAL_X4V3_X2_PLUS_LOCAL_DETAIL
   ↓
maps-hd/*.webp

因此这整个 derivative 层可以退役。
同时扫描 repo 删除：
- AI map upscale scripts
- HD generation tooling
- HD-specific documentation
- HD-specific CI/test assertions
- 所有 maps-hd references
特别是当前：
frontend/src/data/mapHdAssets.test.js

它专门验证 mapImages 与 HD manifest coverage，目标架构下应该删除，而不是为了让测试继续绿去修改它。
2. mapImages.js 回归原始 2D map
现在：
import middleburgImg from '../assets/maps-hd/middleburg.webp'
import fortDespairImg from '../assets/maps-hd/fort-despair.webp'

改为：
import middleburgImg from '../assets/maps/middleburg.webp'
import fortDespairImg from '../assets/maps/fort-despair.webp'

不要重构 mapImages contract。
继续保留：
mapCode
  ↓
{
  src,
  width,
  height,
  coordinateBounds
}

因为目前：
BattlePlayback
MapOverview
BattleMap3D
mapPalette
map geometry tooling
tests

都已经围绕这个 contract 工作。
这次没有理由扩大 blast radius。
3. Verify 原始地图是否真的满足 runtime contract
这里不能只做批量字符串替换。
Agent 必须逐地图检查：
maps-hd/<name>.webp
        ↕
maps/<name>.webp

至少验证：
coverage
filename
dimensions
aspect ratio
mapCode mapping
coordinateBounds

特别注意：当前 docs/reference/maps.md 记录的是诸如：
middleburg.webp (2024x2024)

而 mapImages.js runtime metadata 中出现的是类似：
width: 768
height: ...
coordinateBounds: ...

所以必须确认这些 width/height 的语义到底是：
实际 image intrinsic size

还是：
经过历史处理后的 rendering coordinate metadata

不能因为换回 source image 就盲目重写 width/height。
如果原始图片和 HD 图片 dimensions 不同，但渲染 contract 使用实际 pixel dimensions，则同步修正；如果只是 rendering metadata，则保持。
这是这次实施里最需要人工/测试验证的一点。
4. 不动 3D remote architecture
明确 out-of-scope：
VITE_ASSET_BASE_URL
AssetProvider
COS
3D manifest
GLB
collision
textures
terrain
tank models

现在 CI 已经验证：
asset origin baked into bundle:
https://wotbtools-assets-...cos.ap-shanghai.myqcloud.com

   粘贴的 Markdown (1)
所以不要趁这次 PR 顺手“统一所有 asset”。
我们明确接受：
2D map image → Vite bundled

3D game assets → COS runtime download

这是 intentional architecture，不是 transitional state。
5. 更新 canonical docs
现在文档实际上有部分内容已经符合新方案。
docs/reference/maps.md 本来就说素材位于：
frontend/src/assets/maps/

而不是 maps-hd。
因此这次应该让实现重新和 canonical documentation 对齐。
重点扫描：
docs/reference/maps.md
docs/features/battle-playback.md
README / architecture docs

删除所有：
AI enhanced
AI upscale
maps-hd
Real-ESRGAN
HD basemap

的现役架构描述。
最终写清楚：
2D basemap 的 canonical runtime asset 位于 frontend/src/assets/maps/，来源于游戏客户端解包资源。WotBTools 不生成或维护 AI-upscaled map derivatives。2D basemap 随 frontend artifact 发布；3D assets 独立通过 AssetProvider 从 remote asset origin 按需获取。

6. 增加防回归测试，但不要过度工程化
把现在 HD-specific test 替换成简单的 asset contract test。
建议验证：
mapImages 中每个 static import
        ↓
必须来自 ../assets/maps/

禁止：
../assets/maps-hd/

以及：
所有注册的 map image
→ 文件存在
→ dimensions 合法
→ coordinateBounds 合法

可以再加一个非常便宜的 guard：
frontend/src/assets/maps-hd

不得重新出现。
不建议加：
单张图片必须 < X MB
整个目录必须 < X MB

作为 hard CI gate，除非我们先测完新的实际 baseline。否则现在只是拍脑袋设阈值。
7. Build size verification
这是这次 PR 的重要验收项。
当前 baseline 已经非常清楚：
/usr/share/nginx/html         127.3 MB
/usr/share/nginx/html/assets  123.4 MB

largest frontend layer
≈ 126.6 MB

   粘贴的 Markdown (1)
而且现在 HD 地图单张达到约：
2.9 MB
3.2 MB
3.4 MB
4.1 MB
4.2 MB
...

   粘贴的 Markdown (1)
修改后 CI 必须重新输出：
dist total size
dist/assets total size
Docker image total size
largest Docker layers
largest dist files

验收不是要求一个预先猜测的数字，而是：
证明 maps-hd 已完全退出 bundle，并记录新的 baseline。

然后我们再决定有没有必要设置长期 size budget。
8. 顺便重新验证 TCR，但不要把它定义成修复
这是非常重要的 scope 控制。
这次修改以后：
AI-HD maps removed
        ↓
dist significantly smaller
        ↓
Docker application layer significantly smaller
        ↓
重新执行 Frontend production workflow
        ↓
观察 TCR push

当前失败时最大的 application layer 大约 126.6 MB，而且正是没有完成 publication 的两个最大 layer 之一。   粘贴的 Markdown (1)
如果减重后：
GitHub → TCR
成功

那么我们获得非常强的关联证据，说明 image/layer size 与 TCR publication failure 有关。
但 PR description 不应该写：
Fix TCR timeout.

应该写：
Simplify 2D map assets and remove AI-HD derivatives.

TCR 是验证观察项。
如果减重后 TCR 仍失败，我们继续独立解决 registry transport，不污染这个架构改动。
PR Strategy
一个 PR 足够。
我不建议拆多个 PR，因为：
删除 maps-hd
        +
切换 mapImages
        +
删除 HD tests/tooling
        +
docs cleanup
        +
size verification

本质上是一个 atomic migration。
PR 可以命名：
refactor(frontend): retire AI-upscaled map assets

Definition of Done
- frontend/src/assets/maps-hd/** 删除。
- AI map enhancement manifest/tooling/test 删除。
- repo 不存在有效 maps-hd runtime reference。
- mapImages.js 使用 frontend/src/assets/maps/**。
- 所有当前支持的 2D maps coverage 不减少。
- Playback / MapOverview 地图显示正常。
- map coordinates / markers / bases 与 basemap 对齐。
- 2D map contract 不发生无意义 breaking change。
- 3D AssetProvider/COS 行为完全不变。
- canonical docs 更新。
- frontend tests/build 通过。
- production Docker build 通过。
- CI 输出修改后的 image/payload size baseline。
- production workflow 再跑一次，记录 TCR publication 结果。
- 不通过拆 Docker layer、增加 push timeout 等方式掩盖问题。

## 执行证据与审查记录

- 29/29 原图 SHA-256 与退役 manifest 一致；原图全部 2024×2024，旧 derivative 全部 4048×4048；aspect ratio 不变。mapCode、width/height、coordinateBounds 均未修改；逐图匹配 semantic worldBounds。
- 新测试读取真实 WebP 文件头尺寸，验证本地原图覆盖与有限、有序的世界范围。五个 targeted 测试文件、66 tests 通过（mapAssets、mapView、mapRasterDensity、MapOverview、BattleMap）。
- browser-layout 九个场景全部通过，覆盖 PC/tablet/mobile、原图解码及 non-square 4× leader/marker alignment；Vite build 通过。29 个 bundle WebP 逐字节匹配原图。
- 本地 dist = 70,868,777 B；dist/assets = 70,013,650 B；29 张原图 = 34,429,614 B。该本地 build 未包含上游 Agent WASM，不冒充生产 baseline。生产 Docker build/完整前端 suite/完整 payload baseline 交由 PR CI（已增加真实 Dockerfile build、目录大小、镜像总大小、history 及最大文件报告）。现有生产 workflow 保留自己的容量报告。
- 本机 Docker daemon 不可用，不能宣称 Docker build 已通过。Git Bash 的 fetch-agent-wasm.sh 本地未成功解析 artifact；CI 现有 Linux 下载步骤保留且未修改。
- review-fix verifier：六项检查及 code-smell，零缺陷；主代理 review-with-docs：OCR v1.12.11 delegate preview/rule 完成，3 个 reviewable 文件全部 reviewed；deleted/binary 与文档由 requirement audit 覆盖，新增测试手动审核。无 production abstraction/API/i18n/3D 改动，零代码 blocker。
- fallow dead-code CLI 已运行；报告现有未使用 files/exports/dependencies，未涉及本次修改文件，不扩大本任务处理。
- 生产发布只接受当前 main；合并后 main push 会触发 Frontend owner。TCR 结果待该运行，当前不声明 timeout 修复、不改 layer/timeout/registry transport。

- 最终 delta 复审零缺陷；mapAssets 两个测试重跑通过，workflow YAML parse 通过。HD WebP 总大小 92,658,312 B → 原图 34,429,614 B，纯地图 payload 减少 58,228,698 B（62.84%）。
