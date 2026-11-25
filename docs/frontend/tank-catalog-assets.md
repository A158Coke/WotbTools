# 车辆目录图标与类别

`frontend/src/assets/tank-catalog/sources.json` 记录客户端版本、原始路径、源文件 SHA-256、纹理画布、可见边界与远端路径。**34 条目录素材全部不再随包**：2026-11-25 起由资产 origin（`https://assets.wotbtools.com`，dataset 的 `ui/**`）按 `remote` 字段取用，字节与原客户端文件一致（sha256 34/34 已核对）；`sources.json` 只保留来源与裁剪元数据，bundle 内不保留任何 `tank-catalog` 图片。构成：22 条图标（9 个国别的共享 text/carousel + 6 条 filter + 7 条类别/车种）、9 条 `flag_tutor-tank_*` 封面布旗、3 条美国/德国/中国 filter 补全。常规系别采用 `flags/flag_text_*` 与 `flags/flag_filter_*`（`/ui/flags/**`），国家/系别主视觉采用 `flags/flag_carousel_*@2x`（德国、美国、中国），类别采用车库实际引用的 `icons/icon_tank-normal|premium|collectible`，车种采用 `icons/icon_tank-class_*`（`/ui/lobby-icons/**`）。游戏素材权利归 Wargaming 及对应权利人。

德国使用同版客户端的 `flags/flag_carousel_germany@2x.packed.webp`，原始画布 512×256，可见区域 337×209；远端路径 `/ui/flags/flag_carousel_germany@2x.webp`，科技树与默认国别图标共用这份高清纹理。筛选控件改用 `flags/flag_filter_germany@2x`（无轮播图顶部压暗）。

美国改用同版客户端的 `flags/flag_carousel_usa@2x.packed.webp`（512×256，可见区域 337×209；`/ui/flags/flag_carousel_usa@2x.webp`），筛选控件改用 `flags/flag_filter_usa@2x`。此前用户提供的 `nation-usa.webp` 已于 2026-11-25 删除，不再保留旧素材。

中国改用同版客户端的 `flags/flag_carousel_china@2x.packed.webp`（512×256，可见区域 337×209；`/ui/flags/flag_carousel_china@2x.webp`），筛选控件改用 `flags/flag_filter_china@2x`，标签仍为「中国」。此前用户提供的 CN 布质标识 `nation-china.webp` 已于 2026-11-25 删除。客户端图标与所选车辆数据版本同源；资产 origin 未配置或图片请求失败时图标隐藏，名称、筛选与选择不受影响。

`TankCatalogIcon` 使用原纹理的可见边界去除打包透明留白，并保持可见图案的比例和颜色。所有图标为辅助信息，名称、选中边框和焦点环独立提供。`other` 的中文产品名按用户指定为「闪电系」，客户端这版原文为「多国联军」；过滤参数和车辆身份保留 `other`。国别图标为游戏内分类标识，其用途限定为目录导航。本工具按维护者确认用于非商业用途，素材保留来源及权利说明。

**封面国籍背景（2026-11-25）**：`TankCoverNation` 用 `flag_tutor-tank_*`（1024×512 布旗，9 国齐全）作坦克百科列表卡片与详情封面的**整幅背景**，`object-fit: cover` 铺满；背景层位于坦克图之前（DOM 序在前），坦克图覆盖其上，因此不遮挡坦克。背景为纯装饰（`aria-hidden`），国籍文本仍在卡片徽标行，因而图片缺失不影响可读性；背景不拦截指针事件，点击仍落在整张卡片上。筛选控件统一使用 `flag_filter_*`，不再复用带顶部压暗的 carousel。

类别在 `normalizeTankCache` 读取原始标志时派生。明确 true/1 的 premium 优先；明确 false/0 或缺失 premium、明确 true/1 的 collector 归典藏；两标志明确 false/0 归普通。剩余异常归 unknown，仅在全部下出现。原始标志的既有布尔出口保留，目录边框与筛选统一读 category。普通不承诺可研发或在售。

客户端素材的使用按 [Wargaming 玩家内容政策](https://legal.wargaming.net/en/user-documents/content-policies/player-content-policy/view) 的实际用途条件核对，公开粉丝网站与独立 APK 分发分别评估。
