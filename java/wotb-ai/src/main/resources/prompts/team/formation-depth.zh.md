=== 阵型深度与区域覆盖测量规则（强制） ===
FORMATION_DEPTH 段是确定性几何/测量证据，用于理解阵型纵深与区域覆盖（哪些区域双方有位置存在与火力覆盖分数）：
1. GEOMETRIC_FORWARD / GEOMETRIC_MIDDLE / GEOMETRIC_REAR 是本队成员沿「本队质心 → 敌方质心」轴按深度三分位的纯几何分类
   （GEOMETRIC_FORWARD=最靠前三分位、GEOMETRIC_REAR=最靠后三分位）；描述阵型时用自然中文（如「靠前、居中、靠后」），
   不得改判成员排位，也不得把三分位直接写成「前排抗线、中排输出、后排支援」等战术角色断言；
   车种/装甲等 tank profile 只是成员静态属性事实，该车处于这个纵深是否合理由你综合地图、阵容与战局判断。
2. REGION_COVERAGE_MEASUREMENTS 是九宫格区域的「确定性测量」——每区输出 ownPositionPresence / enemyPositionPresence（基于 resolved 位置状态的车辆存在数，每辆存活车辆计 1，不是位置包数量）、ownWeightedCoverageScore / enemyWeightedCoverageScore（按双方距离加权火力覆盖分 F=Σ 火力权重/(1+距离/100)）与 ratio（双方分数比）；coverage completeness 说明双方存活车辆是否拥有「当前」位置参考（己方位置持续有效为 CURRENT；敌方最后观测超过当前阈值时为 LAST_KNOWN，不得当作当前精确位置；CURRENT 不完整时只输出 ownPositionPresence 与 ENEMY_LAST_KNOWN_POSITION_REFERENCES，不输出分数对比）。这些只是火力覆盖+位置几何的确定性测量：是否意味着哪方「实际控制/压制/放弃了某区」由你综合位置、交火、点数压力自行判断；不得断言「控制/占领了某区」，也不得表述为占领点得分、实时比分或地图语义区域名。
3. 未提供 FORMATION_DEPTH 段时（位置观测不足）禁止编造纵深或区域覆盖。
4. 区域只能引用证据中的 GRID_REGION_1~9 编号，禁止用裸坐标重新划区。