# Android Agent 资产源核验

决定是否退出旧 COS 资产源前，需要分别核对发布标签、签发记录、实际 APK、下载入口和客户端行为。生产 `version.json` 给出当前支持区间，staging 记录给出签发身份，publish job 回读记录证明某次生产发布。APK 内的 Web 路径 `/agent-assets` 指向本机代理，实际远端源由该版本原生代码选择。

## 2026-11-27 核验

生产清单的最低支持版本为 5.4.1（5004001），最新版本为 5.7.2（5007002）。逐版本记录包含远端标签提交、包内提交、实际 APK SHA-256 和大小、bundle 清单摘要、原生类加载的地址、公开下载结果及历史发布凭证。[现场证据矩阵](../research/android-agent-consumers/2026-11-27.json)

| 核验对象 | 实测结果 |
| --- | --- |
| 5.4.1–5.7.2 的 12 个现存标签 | 源站 APK 逐个匹配 staging SHA-256、bundle 文件清单与大小。AndroidManifest 的包名和版本匹配。每个 APK 的 `AgentAssetProxy` 类均加载 `https://assets.wotbtools.com`。 |
| 发布历史 | 10 个区间内版本取得生产清单回读日志。5.4.2 的自动 publish 因 main 已有 5.5.0 跳过；5.7.0 的一次 publish 在取得 staged APK 时网络失败。这两行保留 staged 身份，发布回读栏为空。[5.4.2 调度](https://github.com/A158Coke/WotbTools/actions/runs/43613092015/job/132508070123) · [5.7.0 发布尝试](https://github.com/A158Coke/WotbTools/actions/runs/45082928807/job/137394976496) |
| 公开 APK 地址完整 GET，跟随重定向 | 5.4.1 至 5.6.0 的 8 个候选和旧样本 3.17.0 返回 7,220 字节的清华大学云盘 HTML。5.6.1、5.7.0、5.7.1、5.7.2 均下载到完整 APK 并通过 SHA-256 核验。上述结果仅覆盖本次请求。 |
| 低于 floor 的 3.17.0 | 有历史发布回读。源站 APK、staging 和 bundle 均指向 `4e8acd2e`，当前远端标签指向 `01283ec3`。两个提交的代理源码、Gradle 版本、bridge 合同及 Agent pin 内容相同。反汇编确认 APK 原生类加载旧腾讯 COS 域名。3.17.0 与当前 5.7.2 的 `apksigner verify` 均通过且签名证书 SHA-256 相同。[3.17.0 发布回读](https://github.com/A158Coke/WotbTools/actions/runs/39543923043/job/119037692924) |

本次只读核验在不可变源站文件上计算整包 SHA-256、逐个校验打包的 Web 文件。Android Build Tools 35 的 `aapt` 和 `dexdump` 在本地处理从同一批 APK 提取的 AndroidManifest、资源表和全部 `classes*.dex`，提取件按 SHA-256 核对。历史回读链接按 job 中实际报告的版本关联；workflow 成功本身不足以填写这一栏。

## 已发布 APK 的隔离运行结果

在全新 Android 11 模拟器（API 30、x86_64、KVM）安装签发 APK。默认 ARM64 翻译运行旧版时 Gecko 线程退出；以下结果使用同一 APK 内的 `armeabi-v7a`。测试网络允许控制指定主机的 CONNECT，阻止测试机直连外部 HTTP/S，并将网络标为已验证，以触发原生版本发现。冷缓存每次清除应用数据，热缓存保留应用数据后重启进程。

下表的两个状态码分别来自运行中应用的本机代理 `/agent-assets/index.json`（地图索引）和 `/agent-assets/data/tank_cache.json`。返回 200 时还解析 JSON 并核对内容结构。

| 版本与场景 | 版本清单主机 | 旧 COS | 强更界面 | 地图 / 坦克 |
| --- | --- | --- | --- | --- |
| 3.17.0 冷缓存 | 屏蔽 | 可达 | 观测期间未出现 | 200 / 200，记录到旧域名连接 |
| 3.17.0 热缓存 | 屏蔽 | 屏蔽 | 观测期间未出现 | 200 / 200，返回缓存 |
| 3.17.0 冷缓存 | 屏蔽 | 屏蔽 | 观测期间未出现 | 502 / 502 |
| 3.17.0 冷缓存 | 可达 | 屏蔽 | 显示当前 3017000、最新 5.7.2 和「立即更新」 | 502 / 502 |
| 5.7.2 冷缓存、热缓存（分别测试） | 可达 | 屏蔽 | 观测期间未出现 | 两次均 200 / 200，记录到 Alibaba 资产域名连接 |

保持 COS 屏蔽，在 3.17.0 的强更界面点击「立即更新」，允许该测试应用安装更新并在 Android 系统安装器确认。PackageManager 随后报告版本 5.7.2、code 5007002；从安装后的 `base.apk` 回读的 SHA-256 与生产清单完全一致。核验结束时再次读取生产清单，latest、floor 和 APK 身份与开始时一致。

升级后的应用还能通过本机代理读取 Rockfield 的 `map/karelia/terrain.json`。通过 Android `ACTION_VIEW` 打开仓库的随机战回放样本后，观察到回放工作台；本轮尚未确认该场回放解析完成或 3D 首帧显示。

这次观测给出了一个仍能匿名读取 COS 的历史客户端条件：版本清单主机不可达、资产可达、即便冷启动也能读到数据。生产匿名访问量、旧设备规模和真实手机的覆盖范围仍未知，legacy consumer 退役条件继续开放。

## 重跑

使用包含发布提交的 Git 检出、Python 3.9+（与仓库发布脚本相同的 Python 环境）和 Android SDK build-tools。工作目录设为仓库根目录。保留带时间的生产清单和远端引用广告；本地已有的同名标签可能与远端不同。

```sh
mkdir -p audit/releases
curl -fsSL https://wotbtools.com/download/android/version.json -o audit/version.json
git ls-remote --tags origin 'refs/tags/android-v*' > audit/remote-tags.txt
python3 scripts/android-release/consumer_inventory.py catalog \
  --manifest audit/version.json --refs audit/remote-tags.txt --historical 3.17.0 > audit/catalog.json
```

`catalog` 处理区间内的现存远端标签和显式指定的历史对照，按标签解引用后的提交读取源码。将每个候选的 `wotbtools-android-vX.Y.Z.staging.json` 和对应完整 `.apk` 放入 `audit/releases`。先单独记录公开地址的完整 GET 结果；若返回 HTML，可读取原始签发文件以核验包内容，并保留公开分发失败的记录。

```sh
python3 scripts/android-release/consumer_inventory.py verify \
  --catalog audit/catalog.json --releases audit/releases \
  --build-tools "$ANDROID_HOME/build-tools/35.0.0" > audit/verified.json
```

核验器复用发布流程的 APK bundle 合同，并用 `aapt dump badging` 读取包名和版本。它只接受目标代理类反汇编中的 HTTPS 常量加载指令，避免把 APK 其他类、文档或资源中的域名算作原生实现。签发提交与标签漂移、APK 缺失、大小/摘要不符或原生证据缺失时返回非零。包含 3.17.0 的本次报告应保留 `tagMatchesStaging=false`；这项差异可独立于 APK 字节校验复核。发布期间清单可能前移，结束时再次回读并核对最新提交、摘要和 floor。

进一步核验需补真实设备、完整回放渲染与 COS 对象访问日志，并与 TX/CDN 记录交叉核对。旧 APK 可以匿名直连 COS，TX 代理流量和 CAM 使用量都不能单独覆盖这一人群。依赖退出按 [#810](https://github.com/A158Coke/WotbTools/issues/810) 与 [#801](https://github.com/A158Coke/WotbTools/issues/801) 的验收顺序进行。
