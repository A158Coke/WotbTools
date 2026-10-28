from pathlib import Path


def replace_required(path, old, new, count=None):
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    found = text.count(old)
    if found == 0:
        raise SystemExit(f"missing expected text in {path}: {old[:120]!r}")
    if count is not None and found != count:
        raise SystemExit(f"unexpected count in {path}: {found} != {count} for {old[:120]!r}")
    p.write_text(text.replace(old, new), encoding="utf-8", newline="\n")


reasoning = "java/wotb-ai/src/main/resources/prompts/team/reasoning-contract.zh.md"
replace_required(
    reasoning,
    "=== 团队复盘 v0.6 推理顺序与因果质量约束（强制） ===\n"
    "v0.6 是 reasoning-quality upgrade，不是架构或 schema redesign：继续使用 v0.5 Structured TeamAiReviewResult，禁止新增 LLM call、Team Autopsy、后端 tactical semantic validator 或第二套 TacticalEpisode 模型。",
    "=== 团队复盘推理顺序与因果质量约束（强制） ===\n"
    "当前 Team Review 使用 Structured TeamAiReviewResult；禁止新增 LLM call、Team Autopsy、后端 tactical semantic validator 或第二套 TacticalEpisode 模型。",
    1,
)
replace_required(
    reasoning,
    "12. Produce structured JSON：最后只输出 v0.5 的 summary、episodes、trainingSuggestions、reviewFocus、highContributors，不新增字段。",
    "12. Produce structured JSON：最后只输出 Structured TeamAiReviewResult 的 summary、episodes、trainingSuggestions、reviewFocus、highContributors，不新增字段。",
    1,
)
replace_required(
    reasoning,
    "primaryDiagnosis 只是整场摘要，不得压缩 v0.5 structured result 中的 episodes 或训练建议。",
    "primaryDiagnosis 只是整场摘要，不得压缩 structured result 中的 episodes 或训练建议。",
    1,
)

localizer = "java/wotb-ai/src/main/java/com/wotb/ai/review/TeamPromptLocalizer.java"
en_old = """                        === TEAM REVIEW V0.6 REASONING ORDER AND CAUSAL QUALITY CONTRACT (mandatory) ===
                        This is a reasoning-quality upgrade, not an architecture or schema redesign. Keep the v0.5 Structured TeamAiReviewResult; do not add an LLM call, Team Autopsy, backend tactical semantic validator, or second TacticalEpisode model."""
en_new = """                        === TEAM REVIEW REASONING ORDER AND CAUSAL QUALITY CONTRACT (mandatory) ===
                        The current Team Review uses Structured TeamAiReviewResult; do not add an LLM call, Team Autopsy, backend tactical semantic validator, or second TacticalEpisode model.

                        === EVIDENCE-FIRST AND COACHING JUDGMENT (mandatory) ===
                        - Quality first: do not omit material fact checks, causal comparison, or plausible alternatives merely to save tokens, shorten reasoning, or reduce compute cost. Prioritize factual grounding, tactical judgment, and actionable training quality.
                        - Evidence-before-answer: authoritative facts, canonical facts, observed events, limitations, and coverage supplied in this prompt are the first-party evidence available to this review. Any material fact that can be checked directly from them must be checked before the conclusion. Do not form a tactical story first and then cherry-pick supporting evidence.
                        - Facts strict, judgment broad: factual claims about time, counts, points, base state, position, damage, kills, and roster scope must stay within supplied evidence. Once the factual base is sound, make clear, opinionated coaching judgments that the user may challenge. Tactical judgments may reason, compare, and hypothesize, but must not be presented as deterministic facts.
                        - Do not rewrite unknown as absent: UNSEEN / LAST_KNOWN / PARTIAL / UNKNOWN / UNAVAILABLE do not mean nobody, zero, no support, no firing line, no opportunity, or confirmed. With incomplete evidence, still make the best tactical judgment while preserving uncertainty in the factual layer.
                        - Use the supplied evidence: for a key conclusion that is directly checkable from the input, actually read the relevant facts, time, and scope. Do not ignore direct contradictions or expand an old snapshot, partial observation, known-roster scope, or aggregate window into a continuous/global fact or a new event timestamp.
                        - Failure criterion: if a key definite factual claim contradicts direct evidence in the prompt, or a directly checkable key fact is ignored and an unchecked version drives primaryDiagnosis / episode / trainingSuggestion, the review fails factual integrity. A coaching judgment does not fail merely because it is debatable when its factual basis is accurate and its inference boundary is clear.
                        - No fake external verification: Team Call #2 has no external Tools / Functions. Never claim that tools, web search, or replay data outside the prompt were accessed or verified."""
replace_required(localizer, en_old, en_new, 1)

ru_old = """                        === ПОРЯДОК РАССУЖДЕНИЯ КОМАНДНОГО РАЗБОРА V0.6 И КОНТРАКТ ПРИЧИННОСТИ (обязательно) ===
                        Это обновление качества рассуждений, а не redesign архитектуры или schema. Сохраняйте v0.5 Structured TeamAiReviewResult; не добавляйте новый LLM call, Team Autopsy, семантический тактический валидатор бэкенда или вторую модель TacticalEpisode."""
ru_new = """                        === ПОРЯДОК РАССУЖДЕНИЯ КОМАНДНОГО РАЗБОРА И КОНТРАКТ ПРИЧИННОСТИ (обязательно) ===
                        Текущий Team Review использует Structured TeamAiReviewResult; не добавляйте новый LLM call, Team Autopsy, семантический тактический валидатор бэкенда или вторую модель TacticalEpisode.

                        === ПРИОРИТЕТ ДОКАЗАТЕЛЬСТВ И ТРЕНЕРСКОЕ СУЖДЕНИЕ (обязательно) ===
                        - Приоритет качества: не опускайте проверку существенных фактов, сравнение причин и правдоподобных альтернатив только ради экономии токенов, сокращения рассуждения или вычислительной стоимости. Приоритет — достоверная фактическая база, тактический вывод и полезные тренировочные рекомендации.
                        - Evidence-before-answer: authoritative facts, canonical facts, наблюдаемые события, limitations и coverage из текущего prompt — это первичные доказательства для разбора. Любой существенный факт, который можно прямо проверить по ним, нужно проверить до вывода. Запрещено сначала строить тактическую историю, а затем выборочно подбирать подтверждающие данные.
                        - Факты строго, суждение свободно: утверждения о времени, численности, очках, состоянии баз, позициях, уроне, фрагах и границах состава не должны выходить за предоставленные данные. После надёжной проверки фактов давайте ясное и определённое тренерское суждение, которое пользователь может оспорить. Тактическое суждение может содержать выводы, сравнения и гипотезы, но не должно маскироваться под детерминированный факт.
                        - Не превращайте неизвестное в отсутствие: UNSEEN / LAST_KNOWN / PARTIAL / UNKNOWN / UNAVAILABLE не означают «никого», 0, отсутствие поддержки, линии огня, возможности или подтверждённый факт. При неполных данных всё равно делайте лучший тактический вывод, сохраняя неопределённость фактического слоя.
                        - Реально используйте входные доказательства: если ключевой вывод можно проверить по входу, прочитайте соответствующие факты, время и scope. Не игнорируйте прямые противоречия и не превращайте старый snapshot, частичное наблюдение, известную часть roster или агрегированное окно в непрерывный/глобальный факт либо новое время события.
                        - Критерий провала: если ключевой определённый факт противоречит прямому доказательству в prompt, либо прямо проверяемый ключевой факт проигнорирован и непроверенная версия определяет primaryDiagnosis / episode / trainingSuggestion, разбор проваливает фактическую целостность. Спорность тренерского суждения сама по себе не является провалом, если фактическая база верна и границы вывода ясны.
                        - Не имитируйте внешнюю проверку: у Team Call #2 нет внешних Tools / Functions. Не утверждайте, что вызывались инструменты, выполнялся веб-поиск или проверялись данные реплея вне текущего prompt."""
replace_required(localizer, ru_old, ru_new, 1)

# Structured-result contract is current-state, not a versioned runtime protocol.
for path in [localizer, "java/wotb-ai/src/main/resources/prompts/team/single.zh.md"]:
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    replacements = {
        "=== Team AI Review v0.5 结构化结果（最终输出契约） ===": "=== Team AI Review 结构化结果（最终输出契约） ===",
        "以上 v0.5 契约覆盖本提示中较早的旧 envelope 输出说明": "以上结构化结果契约覆盖本提示中较早的旧 envelope 输出说明",
        "=== Team AI Review v0.5 structured result (final output contract) ===": "=== Team AI Review structured result (final output contract) ===",
        "This v0.5 contract overrides earlier envelope instructions": "This structured-result contract overrides earlier envelope instructions",
        "=== Team AI Review v0.5 структурированный результат (итоговый контракт) ===": "=== Team AI Review структурированный результат (итоговый контракт) ===",
        "Этот контракт v0.5 заменяет более ранние инструкции envelope": "Этот контракт структурированного результата заменяет более ранние инструкции envelope",
    }
    for old, new in replacements.items():
        text = text.replace(old, new)
    p.write_text(text, encoding="utf-8", newline="\n")

# Remove stale Team Review pseudo-version labels from current-state code/comments/tests/docs only.
files = [
    "java/wotb-core/src/main/java/com/wotb/core/replay/evidence/TeamAiReviewResult.java",
    "java/wotb-ai/src/main/java/com/wotb/ai/review/TeamReplayAnalysisService.java",
    "java/wotb-ai/src/main/java/com/wotb/ai/review/AiReviewDonePayload.java",
    "java/wotb-ai/src/main/java/com/wotb/ai/review/AnalyzeResult.java",
    "frontend/src/types/ai-review.ts",
    "java/wotb-ai/src/test/java/com/wotb/ai/review/TeamReviewNaturalCoachContractTest.java",
    "java/wotb-ai/src/test/java/com/wotb/ai/review/PromptRuleContractTest.java",
    "java/wotb-ai/src/test/java/com/wotb/ai/review/TeamReviewQualityGateContractTest.java",
    "java/wotb-ai/src/test/java/com/wotb/ai/review/TeamReplayOfflineEvalHarnessTest.java",
    "java/wotb-ai/src/test/java/com/wotb/ai/review/TeamReplayAnalysisServiceTest.java",
    "java/wotb-ai/src/test/java/com/wotb/ai/review/eval/TeamTacticalSkillLiveBehaviorEvalTest.java",
    "README.md",
    "java/AGENTS.md",
    "java/README.md",
    "frontend/AGENTS.md",
    "docs/architecture/ai-review.md",
    "docs/operations/ai-evaluation.md",
]
for path in files:
    p = Path(path)
    if not p.exists():
        continue
    text = p.read_text(encoding="utf-8")
    text = text.replace("Team AI Review v0.5", "Team AI Review")
    text = text.replace("Team Review v0.5", "Team Review")
    text = text.replace("v0.5 Structured TeamAiReviewResult", "Structured TeamAiReviewResult")
    text = text.replace("v0.5 structured result", "structured result")
    text = text.replace("v0.5 wire schema", "TeamAiReviewResult wire schema")
    text = text.replace("v0.5 recovery", "structured-result recovery")
    text = text.replace("TEAM REVIEW V0.6 REASONING ORDER AND CAUSAL QUALITY CONTRACT", "TEAM REVIEW REASONING ORDER AND CAUSAL QUALITY CONTRACT")
    text = text.replace("ПОРЯДОК РАССУЖДЕНИЯ КОМАНДНОГО РАЗБОРА V0.6 И КОНТРАКТ ПРИЧИННОСТИ", "ПОРЯДОК РАССУЖДЕНИЯ КОМАНДНОГО РАЗБОРА И КОНТРАКТ ПРИЧИННОСТИ")
    text = text.replace("=== 团队复盘 v0.6 推理顺序与因果质量约束（强制） ===", "=== 团队复盘推理顺序与因果质量约束（强制） ===")
    text = text.replace("团队复盘 v0.6 推理顺序", "团队复盘推理顺序与因果质量约束")
    text = text.replace("v0.6 reasoning contract", "reasoning contract")
    text = text.replace("v0.6 推理顺序", "推理顺序")
    text = text.replace("v06CausalReasoningContractIsTrilingual", "causalReasoningContractIsTrilingual")
    text = text.replace("v06LocalizedReasoningContractIsAvailableInThreeLanguages", "localizedReasoningContractIsAvailableInThreeLanguages")
    text = text.replace("v05StructuredOutputContract", "structuredOutputContract")
    text = text.replace("=== Team AI Review v0.5 结构化结果（最终输出契约） ===", "=== Team AI Review 结构化结果（最终输出契约） ===")
    text = text.replace("v0.5 必须", "structured result 必须")
    p.write_text(text, encoding="utf-8", newline="\n")

# Current-state documentation should not narrate obsolete prompt/schema version migrations.
doc_fixes = {
    "java/AGENTS.md": [
        ("Team AI Review v0.6 只升级 prompt 的 tactical reasoning order 与 causal contract：", "Team AI Review 的 prompt 使用 tactical reasoning order 与 causal contract："),
        ("；TeamAiReviewResult wire schema 保持不变", "；结构化结果使用 TeamAiReviewResult"),
    ],
    "docs/operations/ai-evaluation.md": [
        ("两个 `@Tag(\"ai-live\")` 工具已从 legacy envelope / claims validator 迁移到\n`TeamAiReviewResult` + `TeamAiReviewResultParser`", "两个 `@Tag(\"ai-live\")` 工具当前使用\n`TeamAiReviewResult` + `TeamAiReviewResultParser`"),
    ],
}
for path, pairs in doc_fixes.items():
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    for old, new in pairs:
        text = text.replace(old, new)
    p.write_text(text, encoding="utf-8", newline="\n")

# Add explicit trilingual final-prompt contract coverage.
test = Path("java/wotb-ai/src/test/java/com/wotb/ai/review/TeamReviewNaturalCoachContractTest.java")
text = test.read_text(encoding="utf-8")
marker = "    @Test\n    void naturalToneAndLength() {"
if "void evidenceFirstPolicyIsPreservedInAllFinalPrompts()" not in text:
    block = '''    @Test
    void evidenceFirstPolicyIsPreservedInAllFinalPrompts() {
        assertTrue(ZH.contains("Evidence-before-answer"), "ZH 必须保留 evidence-before-answer");
        assertTrue(ZH.contains("事实从严，判断从宽"), "ZH 必须保留事实/判断分层");
        assertTrue(ZH.contains("禁止先形成战术故事，再选择性挑证据支持"), "ZH 必须禁止选择性佐证");
        assertTrue(ZH.contains("事实完整性上失败"), "ZH 必须定义事实完整性失败");
        assertFalse(ZH.contains("v0.5"), "ZH 最终 prompt 不应携带伪 schema 版本");
        assertFalse(ZH.contains("v0.6"), "ZH 最终 prompt 不应携带伪 reasoning 版本");

        final String en = TeamPromptLocalizer.localizeTeamSystemPrompt(ZH, AllowedLanguage.EN);
        assertTrue(en.contains("EVIDENCE-FIRST AND COACHING JUDGMENT"), "EN 必须保留 evidence-first policy");
        assertTrue(en.contains("Do not form a tactical story first and then cherry-pick supporting evidence"),
                "EN 必须禁止选择性佐证");
        assertTrue(en.contains("review fails factual integrity"), "EN 必须定义事实完整性失败");
        assertTrue(en.contains("make clear, opinionated coaching judgments"), "EN 必须保留明确教练判断");
        assertFalse(en.contains("v0.5"), "EN 最终 prompt 不应携带伪 schema 版本");
        assertFalse(en.contains("V0.6"), "EN 最终 prompt 不应携带伪 reasoning 版本");

        final String ru = TeamPromptLocalizer.localizeTeamSystemPrompt(ZH, AllowedLanguage.RU);
        assertTrue(ru.contains("ПРИОРИТЕТ ДОКАЗАТЕЛЬСТВ И ТРЕНЕРСКОЕ СУЖДЕНИЕ"),
                "RU 必须保留 evidence-first policy");
        assertTrue(ru.contains("выборочно подбирать подтверждающие данные"), "RU 必须禁止选择性佐证");
        assertTrue(ru.contains("проваливает фактическую целостность"), "RU 必须定义事实完整性失败");
        assertTrue(ru.contains("ясное и определённое тренерское суждение"), "RU 必须保留明确教练判断");
        assertFalse(ru.contains("v0.5"), "RU 最终 prompt 不应携带伪 schema 版本");
        assertFalse(ru.contains("V0.6"), "RU 最终 prompt 不应携带伪 reasoning 版本");
    }

'''
    if marker not in text:
        raise SystemExit("naturalToneAndLength marker missing")
    text = text.replace(marker, block + marker, 1)
    test.write_text(text, encoding="utf-8", newline="\n")

# The prompt/localizer themselves must no longer advertise v0.5/v0.6 as runtime versions.
for path in [reasoning, localizer, "java/wotb-ai/src/main/resources/prompts/team/single.zh.md"]:
    text = Path(path).read_text(encoding="utf-8")
    for stale in ("v0.5", "v0.6", "V0.6"):
        if stale in text:
            raise SystemExit(f"stale Team Review pseudo-version remains in {path}: {stale}")
