package com.wotb.core.replay.evidence;

import java.util.List;

/**
 * Team Call #2 结构化 envelope（内部 grounding 契约，docs/features/team-ai-review.md Natural Coach 轮）。
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
     * 一条 grounded 陈述（Review Blocker B1：structured factual contract，fail-close）。
     * <p><b>claimType schema</b>（由 {@code TeamReviewEnvelopeParser} 强制）：</p>
     * <ul>
     *   <li>{@code DEATH}：subject + timeSec + evidenceIds；</li>
     *   <li>{@code ALIVE_TRANSITION}：value（机器格式 {@code 7v7 -> 4v6}）+ evidenceIds（timeSec 可选）；</li>
     *   <li>{@code POSITION_REGION}：timeSec + region + count + side（FRIENDLY/ENEMY）+
     *       countSemantics（EXACT/AT_LEAST/SUBSET）+ evidenceIds；</li>
     *   <li>{@code ENEMY_POSITION}：subject（昵称或坦克名；重复坦克名时须用
     *       {@code subjectAccountId} 稳定身份）+ timeSec + region + knowledge（CURRENT/LAST_KNOWN）+
     *       evidenceIds；</li>
     *   <li>{@code TACTICAL}：纯战术观点，不要求 factual machine 字段（Backend 不判断战术观点）。</li>
     * </ul>
     * LOS / SPOTTING / VISION / LINE_OF_SIGHT 禁止作为 claimType（无后端 evidence kind）。
     *
     * @param text           自然语言描述（用户正文同义，ZH/EN/RU 皆可；不与正文重复出现内部标识）
     * @param evidenceIds    引用 GROUNDING FACTS 的证据编号（E1xx）
     * @param claimType      机器语义类型（必填；DEATH / ALIVE_TRANSITION / POSITION_REGION /
     *                       ENEMY_POSITION / TACTICAL）
     * @param timeSec        battle-relative 秒（JSON number；schema 要求时必填）
     * @param region         九宫格区域 1-9（JSON number）
     * @param count          车辆数（JSON number；POSITION_REGION 必填）
     * @param subject        玩家昵称或坦克名（DEATH / ENEMY_POSITION 必填）
     * @param value          机器值（ALIVE_TRANSITION 必填，如 "7v7 -> 4v6"）
     * @param side           阵营（POSITION_REGION 必填：FRIENDLY / ENEMY）
     * @param countSemantics 数量语义（POSITION_REGION 必填：EXACT / AT_LEAST / SUBSET）
     * @param knowledge      敌方位置知识（ENEMY_POSITION 必填：CURRENT / LAST_KNOWN）
     * @param subjectAccountId 后端稳定账号 ID（可选；DEATH / ENEMY_POSITION 身份绑定优先使用，
     *                       同车型敌车多辆时禁止只用坦克名作为唯一身份）
     */
    public record Claim(
            String text,
            List<String> evidenceIds,
            String claimType,
            Double timeSec,
            Integer region,
            Integer count,
            String subject,
            String value,
            String side,
            String countSemantics,
            String knowledge,
            Long subjectAccountId
    ) {
        public Claim {
            evidenceIds = evidenceIds == null ? List.of() : List.copyOf(evidenceIds);
        }

        /** 兼容旧契约（无机器字段；仅测试/文本兜底路径使用，parser 不再产出）。 */
        public Claim(final String text, final List<String> evidenceIds) {
            this(text, evidenceIds, null, null, null, null, null, null, null, null, null, null);
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
