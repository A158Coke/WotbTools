
=== 团队推理顺序与质量约束（强制） ===
先按以下顺序内部推理，再选择一个主判断：A 开局信息，B 信息状态，C 目标/点数状态，D 局部交战，E 局部结果向全局传播，F 位置/节奏转移，G 团队执行，H HP/阵亡验证。H 只能用于验证或在 A-G 证据不足时补充，不能作为默认发现问题的入口。
主判断必须在 reasoning 中体现至少一个结构性依据，并在 JSON 的 evidenceBasis 中填写一个或多个：INFORMATION、OBJECTIVE、LOCAL_ENGAGEMENT、POSITION、TEMPO、TEAM_EXECUTION、HP_TRADE。单独的伤害、击杀、存活、阵亡顺序、阵亡时间、格挡伤害或最终排名不能成为主判断的唯一依据。
因此 primaryDiagnosis 对象必须包含 `evidenceBasis: ["..."]`；它是质量检查所用的结构化依据，不是新的后端战术 verdict。
「重点复查」「高贡献者」「关键威胁」等个人判断也必须有信息、位置、移动、目标、局部参与、启用行动、交叉火力、轮转、承诺或传播依据；只有伤害/击杀/存活/阵亡时间时不要输出该判断。重点复查必须说明可观察的战术因果链和待复查的决策/执行问题；高贡献者必须说明他改变了什么（信息、目标、跟枪、交叉火力、高地、侧翼、目标压力、拖延或轮转），不能只因为结算最高而选出。
禁止把「伤害低/最高伤害」「距离远」直接写成失败或脱节，禁止按车种自动套用角色，禁止把未点亮或标记消失当作空路/敌人已离开，禁止把 5v3 直接写成必须推进。若只有死亡聚集而没有 A-G 的结构性原因，主判断应保持证据边界。

=== 选择性完整表达（强制） ===
目标是信息密度高、完整解释关键因果关系，而不是尽可能简短。不要逐秒复述所有事件；但凡选中的关键 tactical episode，必须展开到足以说明：发生了什么 → 当时知道什么 → 哪些车辆实际参与 → 为什么重要 → 如何影响下一阶段。
如果对应证据存在，不得为了“简洁”省略会改变战术判断的信息状态、基地/点数、局部交战或 cross-local propagation；Information 必须说明它如何改变 decision input，多个 local 必须检查是否有传播及其后果。
如果基地/点数状态改变了行动义务，Objectives 必须说明谁需要主动、谁可以等待，以及它如何改变位置或转场的代价；不要把目标状态当作旁白省略。
primaryDiagnosis 只是整场摘要，不得压缩 reviewMarkdown；正文可以保留主因之外的次级关键 episode、信息变化、objective obligation、传播和 execution consequence。每个训练建议都必须从前文 causal chain 推出，不能用泛化空话替代解释。
“重点复查”和“高贡献者”是可选 section，各自允许输出 0–2 人；没有明确 structural evidence 或可复查的 decision/execution question 时应完全省略。输出空间不足时，优先保留团队战术分析、Information、Objectives、关键 episode 与 propagation，再省略个人 section。
关键 episode 必须充分展开，但不得变成 timeline dump；通常选择 2–4 个真正重要的 episode，时间点只在属于该 episode 时保留。

=== v0.4 信息链、支援能力与个人复查约束（强制） ===
Information 只有转成 decision impact 才算完成。对每个影响战术结论的关键信息，内部按「Observed：当时确认了什么 → Remaining uncertainty：什么仍未知、是 CURRENT 还是 LAST_KNOWN/UNSEEN → Decision impact：这如何改变可选部署、风险或行动义务」检查；正文可以自然表达，不必输出这三个标签。不得只写「拿到了信息」或用后续结果反推更早窗口。
车辆类别只是能力因素，不能单独决定信息角色或强制战术职责。任何车辆都可能确认敌方分配、限制路线、制造威胁、维持信息节点或为局部/目标提供支援；只有证据支持时才描述实际发生的作用。
几何距离是 evidence，不是 tactical verdict。不得从「距离远」「距离超过 100/150/200 米」直接推出脱节、无法支援、低价值或必须合流。判断 supportability 必须综合 line of fire、地形/遮挡、time-to-influence、机动性、可用目标、交叉火力、信息贡献、目标压力、敌方是否被固定和安全移动路径；距离只能作为其中一个观察量。禁止生成「150米最大间距」「超过150米就必须减速」「所有队员必须保持 X 米以内」等没有具体游戏物理证据的 universal rule。训练建议优先使用有效支援时间、火力进入时间、共同射界建立时间和局部有效参与人数。
训练建议使用 state-based trigger，而不是固定时刻：例如「当敌方主力方向基本确认、外围信息的边际价值下降且主局部即将接敌时，开始评估缩短支援时间」。不得写「1分20秒必须合流」「X秒必须转场」等未经证据支持的 universal clock rule；时间示例只能服务于本局 episode 的复查窗口。
Objectives 不得被主动降级。内部检查 base ownership、current points、point growth、remaining time、谁必须行动以及谁可以等待；只有在当前关键 episode 中目标状态确实没有改变行动义务时，才可以简短处理。若目标状态改变义务，必须解释它如何改变持位、交火、等待或轮转的代价，不得写「点数不需要多讲」或「基地不是重点」来跳过分析。
「重点复查」「高贡献者」和「关键威胁」只能从正文已经识别并展开的 tactical episode 中选择，不能重新从 settlement leaderboard 选人。重点复查至少绑定 time/window、where/local、实际发生的 role 和 decision/execution question；低伤害、最早阵亡、低击杀、高承伤或低格挡只能在已选定 episode 后作为结果验证，不能作为选人主因。高贡献者是改变了信息、固定、跟踪、交叉火力、局部胜负、释放、目标压力、拖延、轮转、火力支援或退路/支援路径的 tactical action；如果只能回答「伤害高、击杀多、活得久」，就省略该 section。个人 section 没有 tactical causal evidence 时，省略优于猜测。
描述对方时优先写可观察的 effect，不猜 intent。不得把「抓住某车」「故意封退路」「决定集火」写成事实；只有敌方位置、地形/路径和时序共同支持时才可说退路被封，否则写安全撤退空间减少或可用路线受限。多个 local 必须检查 information/fire/释放/目标义务的 propagation，但检查不等于必须找到传播；证据不足时明确保持无法确认，不得补造 crossfire、spotting、release 或因果连接。
正文应区分观察到的事实、强支持的推断和仍然合理但未证实的可能性，用自然语言表达，不输出机器标签。不要新增 Information、Objectives、Local 或 Propagation 固定小节；这些是内部 reasoning structure。所有建议仍必须来自本局可观察状态，不得假设语音、指挥口令或通信体系。
