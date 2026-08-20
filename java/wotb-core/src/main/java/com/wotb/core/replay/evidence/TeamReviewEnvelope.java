package com.wotb.core.replay.evidence;

import java.util.List;

/**
 * Team Call #2 结构化 envelope（内部 grounding 契约，docs/current-plan.md Natural Coach 轮）。
 * <p>这是 Call #2 的<b>唯一输出格式</b>：{@code reviewMarkdown} 是用户看到的完整自然语言复盘
 * （Backend 绝不自行拼接主体）；{@code primaryDiagnosis} 强制 LLM 选出唯一主判断；
 * {@code claims} 是 machine-readable grounding 元数据（数值/时间/位置/玩家事件类陈述引用
 * GROUNDING FACTS 的证据编号）。evidenceIds 只出现在结构化字段，绝不进入 {@code reviewMarkdown}。</p>
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

    /** 一条 grounded 陈述：text 为自然语言，evidenceIds 引用 GROUNDING FACTS 证据编号。 */
    public record Claim(String text, List<String> evidenceIds) {
        public Claim {
            evidenceIds = evidenceIds == null ? List.of() : List.copyOf(evidenceIds);
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
