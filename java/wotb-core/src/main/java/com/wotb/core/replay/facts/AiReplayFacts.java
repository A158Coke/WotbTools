package com.wotb.core.replay.facts;

import com.wotb.core.model.Battle;
import com.wotb.core.replay.processing.ReplayIdentity;
import com.wotb.core.replay.processing.ReplayProcessingCapabilities;
import com.wotb.core.replay.processing.ReplayProcessingDiagnostics;
import com.wotb.core.replay.processing.ReplayProcessingError;
import com.wotb.core.replay.processing.ReplayProcessingResult;
import com.wotb.core.replay.processing.ReplayProcessingStatus;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;

/**
 * AI Review 需要的 deterministic replay facts（plan §19–§20）。
 *
 * <p>经真实消费者（TacticalReviewHarness / PlayerReplayAnalysisService /
 * TeamReplayAnalysisService / Evidence skills / prompt builders）反向推导：AI 管道
 * 需要 Battle（结算战绩）与 Reconstruction 的<b>完整 deterministic 投影</b>
 * （events / checkpoints / finalState / coverage / diagnostics / participants /
 * metadata / header / duration / battleStart），缺失任一都会被 Evidence skill 或
 * timeline builder 读到 null/空而改变输出。因此 facts = 该输入集合的不可变 JSON 投影，
 * 写临时文件后 atomic move；<b>不</b>包含 raw packet / 原始字节 / 解析器内部结构。</p>
 *
 * <p>与 {@link ReplayProcessingResult} 字段一一对应，{@link #toResult()} 重建同构
 * 结果对象供现有 AI 消费者零改动消费。</p>
 */
public record AiReplayFacts(
        String fileName,
        ReplayProcessingStatus status,
        ReplayIdentity identity,
        Battle battle,
        ReplayReconstruction reconstruction,
        ReplayProcessingDiagnostics diagnostics,
        ReplayProcessingCapabilities capabilities,
        ReplayProcessingError error,
        ReplayProcessingError reconstructionError
) {

    public static AiReplayFacts fromResult(final ReplayProcessingResult r) {
        return new AiReplayFacts(
                r.fileName(),
                r.status(),
                r.identity(),
                r.battle(),
                r.reconstruction(),
                r.diagnostics(),
                r.capabilities(),
                r.error(),
                r.reconstructionError());
    }

    public ReplayProcessingResult toResult() {
        return new ReplayProcessingResult(
                fileName,
                status,
                identity,
                battle,
                reconstruction,
                diagnostics,
                capabilities,
                error,
                reconstructionError);
    }
}
