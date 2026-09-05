
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
