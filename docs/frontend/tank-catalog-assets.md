# 车辆目录图标与类别

`frontend/src/assets/tank-catalog/sources.json` 记录客户端版本、原始路径、源文件 SHA-256、纹理画布、可见边界与远端路径。**25 条目录素材全部不再随包**：由资产 origin（`https://assets.wotbtools.com`，dataset 的 `ui/**`）按 `remote` 字段取用，字节与原客户端文件一致；`sources.json` 只保留来源与裁剪元数据，bundle 内不保留任何 `tank-catalog` 图片。构成（2026-11-27 对齐后）：9 条 `nation-filter-*`（客户端 `flags/flag_tank-tree_*@2x`，128×128、可见区域 97×97，坦克百科筛选与科技树国别页签共用同一套）+ 9 条 `cover-*`（`flags/flag_tutor-tank_*@2x` 封面布旗）+ 7 条类别/车种图标（类别用车库实际引用的 `icons/icon_tank-normal|premium|collectible`，车种用 `icons/icon_tank-class_*`，`/ui/lobby-icons/**`）。2026-11-25 一版的共享 `flag_carousel_*`（美国/德国/中国）与 `flag_text_*`（其余国别）键已随筛选套系统一而删除；此前用户提供素材 `nation-usa.webp` / `nation-china.webp` 早在同日删除。origin 侧 `ui/**` 文件集不变（`flag_tank-tree_*` 本就随全量提取发布，9 国 `@2x` 已在线核对 200）。游戏素材权利归 Wargaming 及对应权利人。

`TankCatalogIcon` 使用原纹理的可见边界去除打包透明留白，并保持可见图案的比例和颜色。所有图标为辅助信息，名称、选中边框和焦点环独立提供。`other` 的中文产品名按用户指定为「闪电系」，客户端这版原文为「多国联军」；过滤参数和车辆身份保留 `other`。国别图标为游戏内分类标识，其用途限定为目录导航。本工具按维护者确认用于非商业用途，素材保留来源及权利说明。

**封面国籍背景（2026-11-25，2026-11-27 扩展到科技树）**：`TankCoverNation` 用 `flag_tutor-tank_*`（1024×512 布旗，9 国齐全；可见 bounds 884×496）作**整幅封面背景**——覆盖坦克百科列表卡片、详情封面，以及科技树节点卡（网格与竖屏等级行两种形态，取当前树国别；图标盒 97×60 ≈ 8:5，与同一 cover 规则吻合）。先按 `sources.json` 的可见 bounds 裁掉打包透明留白，再按 cover 规则放大到 8:5 容器（可见区域宽高比 1.782 > 1.6，按高度铺满、左右裁切），因此不会露出透明边；背景层位于坦克图之前（DOM 序在前），坦克图覆盖其上，不遮挡坦克。背景为纯装饰（`aria-hidden`），国籍文本仍在卡片徽标行，图片缺失不影响可读性；背景不拦截指针事件，点击仍落在整张卡片上。装饰图统一走 `assetProvider.imageUrl()`（Android 未获 PLAYBACK_3D 时静默隐藏，不触发 3D 离线提示）；真正的 3D 资产仍走 `url()`。

**国籍旗单一套系（2026-11-27 用户裁定）**：筛选与科技树国别页签统一用客户端科技树原版 `flag_tank-tree_*@2x`（此前筛选是 `flag_filter_*`、科技树页签混用 carousel 大图/text 小图）。`TankCatalogIcon` 的 `variant` 属性随之删除——国籍图标只有一套 `nation-filter-*` 键，不再按场景分流。

类别在 `normalizeTankCache` 读取原始标志时派生。明确 true/1 的 premium 优先；明确 false/0 或缺失 premium、明确 true/1 的 collector 归典藏；两标志明确 false/0 归普通。剩余异常归 unknown，仅在全部下出现。原始标志的既有布尔出口保留，目录边框与筛选统一读 category。普通不承诺可研发或在售。

客户端素材的使用按 [Wargaming 玩家内容政策](https://legal.wargaming.net/en/user-documents/content-policies/player-content-policy/view) 的实际用途条件核对，公开粉丝网站与独立 APK 分发分别评估。
