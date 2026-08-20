package com.wotb.core.replay.evidence;

import java.util.List;

/**
 * Team Call #2 结构化 envelope（内部 grounding 契约，docs/current-plan.md Natural Coach 轮）。
 * <p>这是 Call #2 的<b>唯一输出格式</b>：{@code reviewMarkdown} 是用户看到的完整自然语言复盘
 * （Backend 绝不自行拼接主体）；{@code primaryDiagnosis} 强制 LLM 选出唯一主判断；
 * {@code claims} 是 machine-readable grounding 元数据（数值/时间/位置/玩家事件类陈述引用
 * GROUNDING FACTS 的证据编号）。evidenceIds 只出现在结构化字段，绝不进入 {@code reviewMarkdown}。</p>
 * <p>三语契约（Review B1-2）：涉及数值/时间/位置/玩家事件的 claim 必须携带机器可校验字段
 * （{@code timeSec} / {@code region} / {@code count} / {@code subject} / {@code value}），
 * validator 优先按结构化字段做语言无关校验；{@code text} 是自然语言描述（ZH/EN/RU 皆可），
 * 仅作兜底文本检查。纯战术观点 claim 使用 {@code claimType=TACTICAL}，不要求机器字段。</p>
 * <p>本 record 由 wotb-web 的 {@code TeamReviewEnvelopeParser} 从 LLM 输出 JSON 解析，
 * 由 {@link TeamFactualConsistencyValidator} 做确定性事实一致性校验。</p>
 */
public record TeamReviewEnvelope(
        PrimaryDiagnosis primaryDiagnosis,
        String reviewMarkdown,
        List<Claim> claims
) {

    /** 唯一主判断（必须有内容：title + reasoning 非空）。 */
    public record PrimaryDiagnosis(
            String title,
            String reasoning,
            List<String> supportingEvidenceIds
    ) {
        public PrimaryDiagnosis {
            supportingEvidenceIds = supportingEvidenceIds == null
                    ? List.of() : List.copyOf(supportingEvidenceIds);
        }

        public boolean hasContent() {
            return title != null && !title.isBlank()
                    && reasoning != null && !reasoning.isBlank();
        }
    }

    /**
     * 一条 grounded 陈述。
     *
     * @param text        自然语言描述（用户正文同义，ZH/EN/RU 皆可；不与正文重复出现内部标识）
     * @param evidenceIds 引用 GROUNDING FACTS 的证据编号（E1xx）
     * @param claimType   机器语义类型（Review B1-2）：DEATH / ALIVE_TRANSITION /
     *                    POSITION_REGION / LAST_KNOWN / TACTICAL（纯战术观点）等；可为 null
     * @param timeSec     battle-relative 秒（机器时间格式，三语通用）；可为 null
     * @param region      九宫格区域 1-9；可为 null
     * @param count       车辆数（位置/存活类）；可为 null
     * @param subject     玩家昵称或坦克名（死亡/位置类归属）；可为 null
     * @param value       机器值（如存活变化 "7v7 -> 4v6"）；可为 null
     */
    public record Claim(
            String text,
            List<String> evidenceIds,
            String claimType,
            Double timeSec,
            Integer region,
            Integer count,
            String subject,
            String value
    ) {
        public Claim {
            evidenceIds = evidenceIds == null ? List.of() : List.copyOf(evidenceIds);
        }

        /** 兼容旧契约（无机器字段；validator 仍按文本兜底校验）。 */
        public Claim(final String text, final List<String> evidenceIds) {
            this(text, evidenceIds, null, null, null, null, null, null);
        }

        /** 机器时间是否可用（非 null 且有限）。 */
        public boolean hasTime() {
            return timeSec != null && Double.isFinite(timeSec) && timeSec > 0;
        }
    }

    public TeamReviewEnvelope {
        claims = claims == null ? List.of() : List.copyOf(claims);
    }

    /** 是否有可用内容（reviewMarkdown 非空且 primaryDiagnosis 有内容）。 */
    public boolean hasContent() {
        return reviewMarkdown != null && !reviewMarkdown.isBlank()
                && primaryDiagnosis != null && primaryDiagnosis.hasContent();
    }
}
