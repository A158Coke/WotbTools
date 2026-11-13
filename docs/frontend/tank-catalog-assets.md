# 车辆目录图标与类别

`frontend/src/assets/tank-catalog/sources.json` 记录客户端版本、原始路径、源文件 SHA-256、纹理画布和可见边界。20 张客户端图保持原文件字节，来自本机 Microsoft Store 版 World of Tanks Blitz 11.21.216.0 的 `Data/Gfx/Lobby/`。常规系别采用 `flags/flag_text_*` 与 `flags/flag_filter_*`，类别采用车库实际引用的 `icons/icon_tank-normal|premium|collectible`，车种采用 `icons/icon_tank-class_*`。游戏素材权利归 Wargaming 及对应权利人。

德国使用同版客户端的 flags/flag_tutor-tank_germany@2x.packed.webp，原始画布 1024×512，可见区域 884×496，原文件字节保留。横排、下拉和科技树共用这份高清纹理。

美国使用用户于 2026-11-14 提供的 wotb-icons-v5-part1.zip 中 png/nations/usa.png。该包来源说明将其列为生成的精修系列图。原始 PNG 为 1536×1024 RGBA，原图哈希与随包 manifest 核对；按比例缩为 512px WebP，保留透明度。横排和下拉共用一份 nation-usa 文件，来源清单同时记录原图与编码后哈希。

中国使用用户于 2026-11-14 提供的 CN 布质标识，按原比例缩至 384px 宽并编码 WebP，原图 SHA-256 记录于 manifest。全图展示且标签为「中国」。来源规则为优先客户端，美国和 CN 使用用户指定素材。图标由前端打包至 Web/APK，与所选车辆数据版本独立，缺图时相邻名称仍可操作。

`TankCatalogIcon` 使用原纹理的可见边界去除打包透明留白，并保持可见图案的比例和颜色。所有图标为辅助信息，名称、选中边框和焦点环独立提供。`other` 的中文产品名按用户指定为「闪电系」，客户端这版原文为「多国联军」；过滤参数和车辆身份保留 `other`。国别图标为游戏内分类标识，其用途限定为目录导航。本工具按维护者确认用于非商业用途，素材保留来源及权利说明。

类别在 `normalizeTankCache` 读取原始标志时派生。明确 true/1 的 premium 优先；明确 false/0 或缺失 premium、明确 true/1 的 collector 归典藏；两标志明确 false/0 归普通。剩余异常归 unknown，仅在全部下出现。原始标志的既有布尔出口保留，目录边框与筛选统一读 category。普通不承诺可研发或在售。

客户端素材的使用按 [Wargaming 玩家内容政策](https://legal.wargaming.net/en/user-documents/content-policies/player-content-policy/view) 的实际用途条件核对，公开粉丝网站与独立 APK 分发分别评估。CN 标识无五星国旗图案。
