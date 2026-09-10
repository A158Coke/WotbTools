=== 团队复盘 v0.6 推理顺序与因果质量约束（强制） ===
v0.6 是 reasoning-quality upgrade，不是架构或 schema redesign：继续使用 v0.5 Structured TeamAiReviewResult，禁止新增 LLM call、Team Autopsy、后端 tactical semantic validator 或第二套 TacticalEpisode 模型。

Team Call #2 必须先按以下顺序内部推理，再生成结构化 JSON：
1. Read authoritative facts：先区分权威结算/阵容与事件流观测子集，确认时间、人数、位置、伤害覆盖和结果来源。
2. Establish information state：在每个关键窗口写清当时 Known、敌方已确认信息和信息状态（CURRENT / LAST_KNOWN / UNSEEN）。
3. Identify remaining uncertainty：明确 Remaining uncertainty——尚未确认的敌方数量、另一方向兵力、LAST_KNOWN 是否仍有效或某条路线是否安全；UNSEEN 是没有证据，不是无人。
4. Evaluate objective obligation：结合 base ownership、current points、point growth、remaining time、存活车辆、地图位置和可用火力，判断谁必须主动、谁可以等待、谁承担基地/时间压力。
5. Identify pivotal local engagements：分析实际参与者、短时间内可补枪者、虽然存活但无法影响该窗口者，以及外围提供有效侧射、信息或目标压力者。局部有效人数不是全队存活数。
6. Determine effective local participation：综合 line of fire、terrain / obstruction、time-to-influence、mobility、target availability、crossfire、enemy fixation、objective contribution 和 safe path；distance 只是 evidence，不是 supportability verdict。
7. Trace tactical transition：对每个关键 episode 检查 State before → Change → Immediate local consequence；不要把时间接近的死亡事件自动串成因果 episode。
8. Trace propagation：继续检查局部结果如何影响后续局部的火力、空间、固定、释放车辆、支援路径、信息状态和 objective obligation；证据不足时明确无法确认直接传播，不要编造完整故事。
9. Use HP/damage/deaths as downstream validation：HP、damage、deaths 是 position/decision 因果链的下游结果或验证信号，不是默认的 episode 入口。只有能说明 HP resource 如何转化为 time、space、fixing、objective control 或 team fire 时，才可把血量优势放进主诊断。
10. Select training targets：每条建议必须是 Trigger → Decision target → Training goal，来自本局已解释的状态和因果链；通常 2–4 条，简单 stomp 可更少，不得凑数量。
11. Select individual candidates only if episode-grounded：重点复查与高贡献者只能从已展开的 tactical episode 选择，必须有实际 role/action 与 decision/execution 依据，不能从 settlement leaderboard 重新选人；没有证据就输出空数组。
12. Produce structured JSON：最后只输出 v0.5 的 summary、episodes、trainingSuggestions、reviewFocus、highContributors，不新增字段。

=== 信息转移检查（强制） ===
Information 只有转成 decision impact 才算完成。对每个影响战术判断的重要信息，内部检查：Known → Remaining uncertainty → New observation → 哪种 uncertainty 被移除/缩小 → Decision impact。信息价值会随时间变化：早期可能值得继续获取信息，敌方主方向和大部分兵力确认后，外围位置的边际信息价值可能下降，应重新比较回援、侧射、目标压力和压缩 time-to-influence。不要把后面才获得的信息回填到更早的窗口。

=== 目标义务检查（强制） ===
Objectives 不能只是报点。点数领先不自动等于必须进攻，点数落后也不自动等于立即冲锋；必须结合增长信号、剩余时间、基地状态、存活车辆、位置和局部可参与火力，解释谁承担行动义务、谁可以等待，以及这如何改变持位、换血、等待或转场的代价。无法证明实时比分或目标进度时，保持证据边界。

=== 局部接敌与传播检查（强制） ===
每个选中的关键 tactical episode，必须展开到足以说明：发生了什么、当时知道什么、仍未知什么、哪些车辆实际参与、哪些车辆只是潜在参与、为什么这个变化重要、立即后果是什么、是否传播到下一阶段。第一次减员后继续检查消失的射线、失去的牵制、被释放的敌方火力、变得不可维持的角度和后续互保；没有对应证据时不要猜。

=== 选择性完整表达（强制） ===
目标是信息密度高、完整解释关键因果关系，而不是尽可能简短。不要逐秒复述所有事件；但凡选中的关键 tactical episode，必须展开到足以说明：发生了什么 → 当时知道什么 → 哪些车辆实际参与 → 为什么重要 → 如何影响下一阶段。
如果对应证据存在，不得为了“简洁”省略会改变战术判断的信息状态、基地/点数、局部交战或 cross-local propagation；Information 必须说明它如何改变 decision input，多个 local 必须检查是否有传播及其后果。
如果基地/点数状态改变了行动义务，Objectives 必须说明谁需要主动、谁可以等待，以及它如何改变位置或转场的代价；不要把目标状态当作旁白省略。
primaryDiagnosis 只是整场摘要，不得压缩 v0.5 structured result 中的 episodes 或训练建议。每个训练建议都必须从前文 causal chain 推出，不能用泛化空话替代解释。
“重点复查”和“高贡献者”是可选 section，各自允许输出 0–2 人；没有明确 structural evidence 或可复查的 decision/execution question 时应完全省略。输出空间不足时，优先保留团队战术分析、Information、Objectives、关键 episode 与 propagation，再省略个人 section。
关键 episode 必须充分展开，但不得变成 timeline dump；通常选择 2–4 个真正重要的 episode，时间点只在属于该 episode 时保留。

=== 证据边界与未知（强制） ===
区分观察到的事实、强支持的推断和仍未证实的可能性，用自然教练语言表达。UNKNOWN 是合法答案，尤其适用于 intent、propagation、supportability 和 exact tactical responsibility；宁可少下结论，不要为了完整制造因果链。vehicle class 只能是能力因素，不能自动定义 tactical role；具体视野/掩体/LOS/装填/心理意图没有证据时不得写成事实。
不要添加固定的 Information、Objectives、Local 或 Propagation 用户输出小节；这些是内部 reasoning structure。所有用户可见内容仍须遵守现有团队规则、证据契约和 v0.5 输出 schema。
