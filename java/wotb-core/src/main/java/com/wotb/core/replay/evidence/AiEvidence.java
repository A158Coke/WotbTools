package com.wotb.core.replay.evidence;

import com.wotb.core.replay.event.DecodeConfidence;
import org.springframework.util.StringUtils;

import java.util.List;
import java.util.Map;

/**
 * 统一的战术证据载体。
 * <p>数值与文本指标分开存储（均为原始类型 map），保证确定性渲染与测试；
 * 渲染成 Prompt 时由调用方按 {@code labels}/{@code numbers} 字段逐项输出。</p>
 * <p><b>Backend Evidence Boundary（PR #103 架构收口）</b>：Backend Evidence MUST represent
 * observed facts / deterministic derived measurements / neutral structural classifications；
 * Backend Evidence MUST NOT encode player intent、tactical correctness、tactical benefit、
 * tactical blame 或 recommendation——战术解释（拖延/脱节/图控/交换是否值得等）全部由 LLM
 * 基于多个事实自行判断。新增 Evidence Skill 时必须遵守。</p>
 *
 * @param id         稳定证据 ID（如 CW_01 / HM_03）
 * @param type       证据类型
 * @param startSec   battle-relative 开始秒
 * @param endSec     battle-relative 结束秒
 * @param entities   关联实体
 * @param numbers    数值指标（HP、人数、距离、覆盖率等）
 * @param labels     文本指标（区域编号、路线、人数对比 "4v3" 等）
 * @param confidence 置信度，来自底层数据与覆盖率的确定性合并
 * @param priority   确定性优先级
 * @param provenance 权威层级
 * @param summary    一行人类可读摘要（Prompt 前部索引用）
 */
public record AiEvidence(
        String id,
        EvidenceType type,
        float startSec,
        float endSec,
        List<EntityRef> entities,
        Map<String, Double> numbers,
        Map<String, String> labels,
        DecodeConfidence confidence,
        EvidencePriority priority,
        EvidenceProvenance provenance,
        String summary
) {
    public AiEvidence {
        if (!StringUtils.hasText(id)) {
            throw new IllegalArgumentException("id must not be blank");
        }
        if (type == null) {
            throw new IllegalArgumentException("type must not be null");
        }
        if (!Float.isFinite(startSec) || startSec < 0f) {
            throw new IllegalArgumentException("startSec invalid: " + startSec);
        }
        if (!Float.isFinite(endSec) || endSec < 0f) {
            throw new IllegalArgumentException("endSec invalid: " + endSec);
        }
        if (startSec > endSec) {
            throw new IllegalArgumentException("startSec > endSec: " + startSec + " > " + endSec);
        }
        entities = entities == null ? List.of() : List.copyOf(entities);
        numbers = numbers == null ? Map.of() : Map.copyOf(numbers);
        labels = labels == null ? Map.of() : Map.copyOf(labels);
        if (confidence == null) {
            confidence = DecodeConfidence.UNKNOWN;
        }
        if (priority == null) {
            priority = EvidencePriority.NORMAL;
        }
        if (provenance == null) {
            provenance = EvidenceProvenance.BACKEND_SKILL;
        }
        if (!StringUtils.hasText(summary)) {
            summary = type.name();
        }
    }
}
