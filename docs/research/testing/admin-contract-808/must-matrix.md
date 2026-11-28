# 管理页 MUST 逐条验收

2026-11-28 整合实现候选为 `0eb3ba36f1e7cbcaa2a6a9a2416209f2f4c10bda`，此前的专项回执绑定 `b2e2cafa7`。规则 ID、强度、适用范围和正式例外以[设计契约](../../../frontend/design-language.md)为准。本表逐条登记该版本的 75 条 MUST，保留页面摘要中的成功场景，也记录证据未覆盖的部分。

## 样本与读法

- **八页**指用户、战斗数据、AI 反馈、站点反馈、名人堂、赛事配置、赛事录分和推荐配置。角色分别是站点管理员、HoF 管理员、赛事管理员或内容管理员。匿名、普通用户与组合角色用于权限对照。 fixture 使用下表链接脚本中的本地 HTTP 数据；禁止真实管理写入。
- **矩阵**在 Windows Chrome 中读取实际 `data-ui-profile`。角色用 1280 桌面键鼠及 360 触屏抽屉。四季结构用 1280×850、英语。布局使用 360×740、412×839、390×664、375×553、844×340 粗指针，以及 900×900 和 1280×850。各页专项另涵盖中、英、俄语、鼠标、键盘或触屏，精确配置在对应脚本。
- `compliant` 仅评价该行指定适用对象；一条适用 MUST 只有部分证据时记 `pending/unverified`。`violation` 指已有反例。`explicit exception` 仅用于契约已有的例外。`不适用` 表示八个管理入口没有规则所指对象。
- [页面、原始问题与前后图](README.md) · [矩阵脚本][M] · [用户和反馈][D] · [战斗筛选][B] · [名人堂][H] · [待审计数][P] · [赛事][T] · [推荐][C] · [横幅取样][V]

## 逐条结论

| MUST | 适用对象与预期 | 实际观察、证据类型及边界 | 结论 |
|---|---|---|---|
| DC-TOK-01 | 八页的视觉值使用语义 token | 全量 stylelint 通过；存量 CSS 在 legacy 名单内时仍需人工核对其余值。[样式检查配置][L] | pending/unverified |
| DC-TOK-02 | legacy 名单只减不增 | 对照实施基线，`showcase-pages.css` 从名单移除，未增加条目。[名单][L] | compliant |
| DC-THM-01 | 八页四季共用布局和交互结构 | 相同夹具的 32 组根视图 h1、字号和控件序列一致。弹层各状态未全做逐主题结构比对。[M] | pending/unverified |
| DC-THM-02 | 真实材质叠合可读、可触控，覆盖设备性能和降级 | 横幅有像素取样，小屏有真实命中。未取得所有材质的设备合成性能与禁用滤镜对照。[V]、[M] | pending/unverified |
| DC-THM-04 | 页头置于数据区上方，宽屏首屏可见数据 | 八页核对单一页头，截图覆盖用户、战斗数据、反馈、名人堂及赛事；未断言各内部状态的首屏数据位置。[M] | pending/unverified |
| DC-THM-05 | 页头文字区域最不利像素通过对比度门槛 | 8 个入口在本候选按 390/1280 和四季重新取样，64 个组合均通过标题及短标签前景与实际背景的最差像素门槛。[V]、[取样记录](README.md#角色四季及视口) | compliant |
| DC-THM-06 | 减少动效时页头无动画 | 紧凑页头自身样式无动画声明；未对所有继承样式和状态做运行时 reduced-motion 取样。[页头][Hero] | pending/unverified |
| DC-THM-07 | 四季四层表面及实际玻璃叠合满足 AA | token 测试按真实图片和遮罩取样；未穷尽管理弹窗内所有叠合。[主题对比测试][Contrast] | pending/unverified |
| DC-THM-08 | 场景根使用不透明表面 | 八个管理页均非回放、装甲或 3D 地图场景。[视图注册][Registry] | 不适用 |
| DC-THM-09 | 环境背景由外壳统一渲染 | AppShell 的单一固定背景覆盖四边，使用背景 token、负层级及 pointer-events:none，页面复用该壳。[外壳][Shell] | compliant |
| DC-THM-10 | 环境图解码后显示，减少动效时直接显示 | 代码中有解码及 reduced-motion 降级；冷缓存首屏切换未按八页实测。[Shell] | pending/unverified |
| DC-THM-11 | 卡片、表格、输入与玻璃降级符合表面约定 | 筛选栏有不支持 backdrop-filter 时的纯色回退；其他实际表面及设备性能仍待验。[筛选栏][Filter]、[Contrast] | pending/unverified |
| DC-THM-12 | 分区页头用同一张主视觉，标题可读 | 八页使用管理分区图。图片由静态 import 经 Vite 发布，用户管理在宽屏核对背景满宽、保持比例及文字可读，手机验证原焦点构图。[分区资产][Art]、[V] | compliant |
| DC-CLR-01 | 四季文字与 UI 图形符合对比度门槛 | 有 token、横幅和状态条取样；未测每个内联状态、禁用态与浮层文字组合。[Contrast]、[V] | pending/unverified |
| DC-CLR-02 | 一个视图最多一个强调填充主操作 | 默认根视图已列出实际主按钮；复杂编辑态、确认弹层仍需按视图上下文检查。[M]、[页面摘要](README.md) | pending/unverified |
| DC-CLR-03 | 战斗数据的阵营不能只用颜色区分 | 出生侧表头、胜/平/负文字和分段位置同时标识结果，条带有可访问名称。[出生侧场景][Spawn] | compliant |
| DC-CLR-04 | 物理队伍颜色不随录像者交换 | 管理页按汇总的出生侧及队伍渲染，不含根据录像者身份切换队色的视图。[战斗数据页][Battle] | 不适用 |
| DC-TYP-01 | 八页文本至少 12px，导航角标无小字例外 | 图标侧栏 99+ 的 11px 覆盖已移除，实测字体至少 12px 并检查命中及边界。其余页及弹层全部文本节点尚未盘点。[P] | pending/unverified |
| DC-TYP-02 | 表格统计使用等宽数字及 locale 数字格式 | 战斗统计、用户汇总、名人堂审核已接入当前语言格式。三语用例覆盖 25,001、1,001 及百分比；其他表格及计时仍待全面核验。[战斗数据页][Battle]、[用户分页][D] | pending/unverified |
| DC-TYP-03 | 超大展示字号限于横幅标题和关键数字 | 记录了八个 h1 实际字号。尚未逐项核对数据区所有值。[M] | pending/unverified |
| DC-TYP-04 | 页面仅用系统字体 | 全站基础字体 token 使用系统字体栈；未逐一检查各状态下的网络字体请求。[尺寸与字体][Scale] | pending/unverified |
| DC-SIZ-01 | 触控目标满足契约最小尺寸 | L6 查遮挡；命中可达性不等于尺寸达标。未测全部可交互目标的 44×44 区域。[M]、[T] | pending/unverified |
| DC-SIZ-02 | 层级经语义 token | 桌面地图筛选展开用已有层级 token；未核对各管理浮层的全部层级声明。[Filter] | pending/unverified |
| DC-MOT-01 | 动效参数由共享策略持有 | 已有 motionPolicy 测试；未完成全部页面和第三方浮层的参数来源追踪。[动效测试][Motion] | pending/unverified |
| DC-MOT-02 | 减少动效时去除空间运动 | 共享降级及背景 transition 有源码证据。数字更新、抽屉、选择器与确认弹层缺少 reduced-motion 下的完整实际操作记录。[Motion]、[Shell] | pending/unverified |
| DC-MOT-03 | 回放表现层遵循真实时间、事件及 HP | 八页不渲染回放时间轴和场景，名人堂仅提供回放证据操作。[Registry] | 不适用 |
| DC-MOT-04 | transition 明列属性 | 已复核本次新增样式；未扫齐所有传递引入的共享样式和浮层。[Hero]、[导航][Nav] | pending/unverified |
| DC-OCC-01 | 常驻 UI 不遮挡主内容 | 百场／三环已越过吸顶阈值并验证详情顶部、正文末项和决定栏。 [详情证据](README.md#2026-11-28-百场与三环审核详情)。七视口矩阵验证默认根视图。小屏规则输入另有逐格命中；其余内部状态尚无同等覆盖。[M]、[T] | pending/unverified |
| DC-OCC-02 | 瞬态面盖过本上下文的常驻控件 | 地图和表格重叠处真实点击，手机筛选表单使用同一 Sheet。其他所有瞬态面的层叠未穷举。[B]、[H] | pending/unverified |
| DC-OCC-03 | 可见交互项能命中 | 八个根入口均有非零主体采样；两个审核域对详情控件另做五点命中与实际操作。 [详情证据](README.md#2026-11-28-百场与三环审核详情)。用户等根视图扫描可见控件五点，赛事逐个滚入，HoF rail 角标可点击。全量菜单状态待验。[M]、[T]、[P] | pending/unverified |
| DC-OCC-04 | 四种规定形态覆盖状态组合 | 审核上部、中下部、拒绝和通过确认已实测桌面、平板、手机与矮横屏。 [详情证据](README.md#2026-11-28-百场与三环审核详情)。已有 L6 五视口与抽屉、弹窗专项；未逐项遍历每种浮层组合。[M] | pending/unverified |
| DC-RSP-01 | 全站三档断点及 CSS range 写法 | 新横幅复用 768px 边界，八入口按三档检查。所有存量样式分支未核完。[Hero]、[M] | pending/unverified |
| DC-RSP-02 | 三档保留相同操作能力 | 筛选、审批、配置、录分有交互证据；所有页面的全部操作未在三档逐一执行。[D]、[H]、[T] | pending/unverified |
| DC-RSP-03 | 360/390 根页面无横溢，宽表在容器内滚动 | 另已验证 360/390 的两个审核详情、列边界与正文末项。 [详情证据](README.md#2026-11-28-百场与三环审核详情)。8 个入口在两个宽度的根页面横溢检查通过，赛事和 HoF 另有宽表滚动断言。[M]、[T]、[H] | compliant |
| DC-RSP-04 | 断点改布局，普通尺寸有伸缩边界 | 用户管理背景随页头尺寸等比覆盖；其他页面每个尺寸声明未逐一核对。[Hero] | pending/unverified |
| DC-RSP-05 | 贴边元素避让四边安全区 | 五个 L6 视口断言真实 CSS env、可见控件、横屏抽屉；浮层专项未遍历全部安全区组合。[M]、[P]、[T] | pending/unverified |
| DC-RSP-06 | hover 有媒体条件，核心操作无需悬停 | 审核、查询和导入可由触屏完成；所有 hover 样式未核完。[H]、[D]、[T] | pending/unverified |
| DC-RSP-07 | 页面允许浏览器缩放 | 八页共用入口的 viewport 未设置 user-scalable=no 或 maximum-scale 限制。[入口 HTML][Index] | compliant |
| DC-RSP-08 | 手势操作有按钮或键盘替代 | 抽屉用菜单打开，可用 Esc 关闭；其他手势路线未完成盘点。[P]、[H] | pending/unverified |
| DC-CMP-01 | 交互控件具有适用的普通、悬停、焦点、活动、禁用和加载态 | 已测待审加载与未知、筛选提交、失败恢复及危险操作；未对每种控件逐态截图。[P]、[D]、[B] | pending/unverified |
| DC-CMP-02 | 业务页仅通过项目组件使用 Reka/Motion | 依赖归属测试扫描源码，第三方 primitive 限制在允许的边界。[依赖检查][Deps] | compliant |
| DC-FOC-01 | 键盘焦点具有可见的统一焦点环 | 侧栏有 focus-visible 样式，地图和审核已有键盘与返焦断言。尚缺所有主要控件在四季背景上实际可见焦点环的检查。[Nav]、[H]、[B] | pending/unverified |
| DC-FOC-02 | 键盘可完成主流程，关闭后返焦 | 反馈取消返原按钮、删除返列表区域；审核、清分、设默认、抽屉关闭有实际焦点断言。推荐编辑与其他表单路径未逐一覆盖。[D]、[H]、[P]、[T] | pending/unverified |
| DC-FOC-03 | 固定及吸顶控件不遮住焦点 | 审核详情已补表单和图片下载的正反向键盘命中、取消和返焦。 [详情证据](README.md#2026-11-28-百场与三环审核详情)。L6 测可见控件命中，赛事另有逐项滚入。尚缺跨键盘 Tab 顺序逐项检查焦点位置。[M]、[T] | pending/unverified |
| DC-A11-01 | 操作与导航语义正确，图标按钮具名 | 待审入口沿用一个 RouterLink，视觉 badge 不单独获焦。其他图标按钮未遍历可访问树。[P]、[Nav] | pending/unverified |
| DC-A11-05 | 可访问名称包含可见标签 | 待审导航模板把名称和完整数量传入三语 aria-label，浏览器核对 99+ 实际总数。未逐项验证所有长标签和截断操作。[Nav]、[P] | pending/unverified |
| DC-A11-02 | 表单有标签，不能只用占位文本 | 地图 combobox、反馈状态 radio group 及用户搜索有名称；赛事和推荐的每个输入仍需核对可访问树。[B]、[D]、[T] | pending/unverified |
| DC-A11-04 | 图片有 alt/装饰语义，非首屏懒加载并预留尺寸 | 页头配图为 aria-hidden 背景；证据图和推荐内容图未全部核对 alt、尺寸和加载时机。[Hero]、[H]、[C] | pending/unverified |
| DC-FRM-02 | 表单允许粘贴 | 管理页输入自身未发现 paste 拦截；未在各编辑器中端到端执行粘贴。[D]、[T]、[C] | pending/unverified |
| DC-FRM-04 | 有草稿的 AppDialog 遮罩点击不丢内容 | 赛事 CSV/历史导入、清分/订正对话框显式配置 closeOnScrim；推荐配置的 CreatorForm 为页内表单。其余可编辑浮层仍需逐项验证。[赛事录分源码][Score]、[推荐编辑器][Editor] | pending/unverified |
| DC-SEL-01 | 控件匹配固定或动态域的可能上限 | 地图、车辆、赛事和军团以大集合验证，短状态与胜方采用 Choice Group。尚未冻结推荐和赛事所有辅助字段的域上限。[B]、[D]、[H]、[T] | pending/unverified |
| DC-SEL-02 | 两项互斥不得用下拉，已登记例外除外 | 反馈行内两态已实测为 radio group；名人堂单场 battleType、replayAvailable 和 sort 仍各有一项只减不增的已登记例外。[选择策略基线][Sel]、[D] | explicit exception（仅这三处） |
| DC-SEL-03 | 非例外的大集合必须可搜索 | 地图 29 项、单场车 12 项、百场及三环各 85 项、赛事及清分军团 12 项均可搜索，核对选值和查询语义。[B]、[H]、[T] | compliant（所列数据域） |
| DC-SEL-06 | Switch 仅用于即时布尔状态 | 已审赛事默认设置涉及独立确认与服务端写入；未盘点所有 Switch 的提交时机。[赛事配置][Config]、[T] | pending/unverified |
| DC-SEL-07 | 响应式变换保留单选/多选的值语义 | 地图桌面弹层与手机 Sheet 都保持单选；名人堂、清分也核对提交值和次数；其他控件缺跨档断言。[B]、[H]、[T] | pending/unverified |
| DC-SEL-08 | 同一概念跨页控件一致 | 两反馈页状态组复用同一 primitive；两赛事页共用赛事选择。尚未盘点所有同概念字段。[D]、[T] | pending/unverified |
| DC-ICN-01 | 控件使用 Lucide；游戏资产适用已登记例外 | 侧栏与新选择控件复用 Lucide。其他页面、动态内容和所有状态图标未完全盘点。[Nav]、[选择器][Picker] | pending/unverified |
| DC-ARC-01 | 单一页头，下接工具条、数据或表单区 | 8 个根入口均有唯一可见 h1、紧凑页头；页头自身不包含交互按钮。[M] | compliant（八个根入口） |
| DC-ARC-02 | 管理工具用紧凑页头，操作位于页头下 | 已查八页紧凑样式和可见操作位置；用户管理保持 Owner 确认的放大分区，另实测三种矮屏首条用户完整可见。[M]、[V] | compliant |
| DC-ARC-03 | 桌面/平板行内筛选，手机使用 Sheet 和生效芯片 | 用户与战斗按最后成功查询，名人堂复核搜索、即时筛选及当前页选择；其余子流程是否为筛选或导航尚待盘点。[D]、[B]、[H] | pending/unverified |
| DC-ARC-04 | 导航配置唯一，桌面和抽屉共用 | 注册表与 ADMIN_NAV 差集、7 种角色的两种导航集合一致，手机复用 AppSidebar。[M]、[Nav] | compliant |
| DC-ARC-07 | 全部 PRIMARY_NAV 均能从两种外壳实际点击进入 | 管理项属于 ADMIN_NAV；该规则指向全站主导航。此处不把管理入口集合测试作 PRIMARY_NAV 验收。[导航定义][Navigation] | 不适用（管理项） |
| DC-ARC-08 | 小屏满足 L1–L6 | L6 五视口实测安全区、逐段滚动与五点命中；L1–L5 的各项条件尚未逐条结案。[M] | pending/unverified |
| DC-ARC-06 | 复杂表格在手机转为卡片或仅容器滚动 | 用户与反馈窄屏卡片，赛事矩阵和名人堂宽表局部横滚；八个默认根页面 360/390 无页面横溢。[M]、[D]、[T]、[H] | compliant（所列列表与矩阵） |
| DC-STA-01 | 数据区有理想、加载、空、错误与无权限态 | 角色全矩阵及待审提示覆盖多种状态；未对每个数据区分别收齐五态。[M]、[P] | pending/unverified |
| DC-STA-02 | 失败可见，给出下一步 | 两类反馈验证拒绝/结果不明/回读失败；待审失败可手动刷新。其余错误提示下一步文案仍需遍历。[D]、[P]、[C] | pending/unverified |
| DC-STA-03 | 未知与成功分明，草稿不冒充结果 | 待审两端同时成功才发布；用户与战斗的成功快照、推荐草稿及赛事预览分别有行为断言。其他数据区缺少系统性的缺失值样本。[P]、[B]、[D]、[T]、[C] | pending/unverified |
| DC-STA-04 | 危险操作经撤销或确认，不能静默执行 | 反馈/用户删除取消零写入、重试 ID 有界，名人堂审批绑定记录，赛事清分确认与取消有夹具请求计数。未逐项验收其余危险操作。[D]、[H]、[T]、[C] | pending/unverified |
| DC-STA-06 | 长内容在容器内换行或截断 | 百场／三环已验证连续长文件名、长车名及昵称的列边界与完整阅读。 [详情证据](README.md#2026-11-28-百场与三环审核详情)。俄语图标侧栏与 99+ 角标在链接内，赛事有俄语和小屏场景；各页极长昵称/车型/无空格内容未全覆盖。[P]、[T] | pending/unverified |
| DC-CPY-01 | 文案走 i18n，三语枚举映射 | 词条测试编译全语言字典，新增角标摘要和选择器有三语。未审完所有动态枚举的 fallback。[语言测试][I18n] | pending/unverified |
| DC-CPY-02 | 文案符合术语表，无禁用词 | 现有测试检查词条，不等同于人工逐项核过三语术语。需针对八页和错误文案走查。[I18n]、[契约](../../../frontend/design-language.md) | pending/unverified |
| DC-ACC-01 | 页面 PR 明列规则、主题、断点和人工盲区 | 四个页面 PR 及本目录记录角色、尺寸、规则、截图和真机边界。[实施 PR 列表][Rollup] | compliant |
| DC-ACC-02 | 页面视觉改动有桌面/手机、盛夏/寒冬的前后截图 | 审核子流程有同夹具、旧基线及最终实现的桌面和手机分状态对照。 [详情证据](README.md#2026-11-28-百场与三环审核详情)。页面摘要有多组前后对照。HoF 车辆的固定样本为 1280 盛夏/390 寒冬，新增横幅几何示例为 1890 寒冬；缺失组合仍待补图。[截图索引](README.md)、[横幅对照](admin-users-hero.webp) | pending/unverified |
| DC-ACC-03 | 受影响浏览器门禁通过 | 四个专项的本地实跑见下表；各页面最终面向 main 的 Required Gate、整合 CI 须按对应 SHA 独立核对。[CI 配置][CI] | pending/unverified |
| DC-ACC-04 | 发现 WebView 与 Chromium 差异时补真机证据 | 已测 Chromium 触屏仿真。真实软键盘、Safari、GeckoView 未跑；若出现平台差异，需针对差异取得真机证据。[页面摘要](README.md) | pending/unverified |

## 仍阻止关单的事项

本轮已修复 DC-TYP-02 的已知反例。75 条 MUST 中，14 条按所列范围符合，56 条待充分验证，1 条为明确例外，4 条不适用。表内未覆盖的适用 MUST 仍需对应的测试、人工复核或来自契约 owner 的明确例外。优先补全全页字号与焦点环、减少动效、表单及弹层状态、叠合可读性、触控尺寸和平台差异证据。PR 已批准或某个分片绿色不能替代这些结果。

## 专项执行记录

四个命令均从上述实现候选的 `frontend` 目录执行，使用本地 Chrome 和受控数据。它们均在 package.json 提供脚本；当前 [CI 工作流][CI] 未单独调用这四项。GitHub 上原有的交互分片有各自的 checkout、范围和结果，不能据此为这四项填写 PASS。

| 本地命令 | 结果 | 独立覆盖 |
|---|---|---|
| `pnpm run test:browser-hof-pending` | 5/5 通过 | 5 种导航形态 |
| `pnpm run test:browser-admin-directory` | 37/37 通过 | 18 个既有场景及 19 个三语分页、矮屏、俄语卡片场景 |
| `pnpm run test:browser-tournament-admin` | 32/32 通过 | 两个赛事入口，含不同语言、视口与四季组合 |
| `pnpm run test:browser-admin-contract` | 19/19 通过 | 7 组角色、7 组视口、4 组主题、1 个探针反例 |

[逐场景执行输出](local-browser-results.txt)。该提交后的矩阵和回执属于文档变更。

[M]: ../../../../frontend/scripts/browser-admin-contract.mjs
[D]: ../../../../frontend/scripts/browser-admin-directory.mjs
[B]: ../../../../frontend/scripts/browser-battle-data-filters.mjs
[H]: ../../../../frontend/scripts/browser-hof-admin-tabs.mjs
[P]: ../../../../frontend/scripts/browser-hof-pending-count.mjs
[T]: ../../../../frontend/scripts/browser-tournament-admin.mjs
[C]: ../../../../frontend/scripts/browser-creators.mjs
[V]: ../../../../frontend/scripts/browser-showcase-hero.mjs
[L]: ../../../../frontend/stylelint.legacy.json
[Registry]: ../../../../frontend/src/app/viewRegistry.js
[Filter]: ../../../../frontend/src/components/AdminFilterBar.vue
[Shell]: ../../../../frontend/src/app/AppShell.vue
[Battle]: ../../../../frontend/src/components/BattleDataAdminPage.vue
[Spawn]: ../../../../frontend/scripts/browser-battle-data-spawn-bar.mjs
[Scale]: ../../../../frontend/src/styles/tokens/scale.css
[Motion]: ../../../../frontend/src/shared/motion/motionPolicy.test.ts
[Deps]: ../../../../frontend/src/shared/ui-dependency-ownership.test.ts
[Nav]: ../../../../frontend/src/app/AppSidebar.vue
[Index]: ../../../../frontend/index.html
[Editor]: ../../../../frontend/src/components/CreatorsConfigPage.vue
[Score]: ../../../../frontend/src/components/TournamentPointsAdminPage.vue
[Config]: ../../../../frontend/src/components/TournamentPointsConfigPage.vue
[Sel]: ../../../../frontend/src/shared/selection-policy.test.ts
[Picker]: ../../../../frontend/src/components/SearchableSelect.vue
[I18n]: ../../../../frontend/src/locales/messages.test.js
[Art]: ../../../../frontend/src/shared/sectionHeroes.ts
[Hero]: ../../../../frontend/src/components/ShowcaseHero.vue
[Contrast]: ../../../../frontend/src/styles/tokens/color-contrast.test.ts
[Navigation]: ../../../../frontend/src/app/navigation.js
[CI]: ../../../../.github/workflows/ci-frontend.yml
[Rollup]: https://github.com/A158Coke/WotbTools/pull/1116
