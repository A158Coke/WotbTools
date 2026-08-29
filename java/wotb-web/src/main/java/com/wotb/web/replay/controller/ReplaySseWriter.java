package com.wotb.web.replay.controller;

import com.wotb.web.replay.dto.AnalyzeResponse;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.IOException;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 把 {@link com.wotb.web.replay.ai.AiReviewStreamListener} 阶段/事件翻译成
 * SSE 事件写入 {@link SseEmitter}。协议（自定 JSON event，{@code data} 为 JSON）：
 * <pre>
 * event: call1_start      // Call #1（赛前战略基线）开始
 * event: call1_done       // Call #1 结束（无论成败，真实发起调用时必发）
 * event: evidence_done    // 后端证据分析完成
 * event: call2_token      // 主复盘 token 增量，data: {"delta":"..."}
 * event: autopsy_start    // Team Autopsy（战犯/MVP）开始
 * event: autopsy_done     // Team Autopsy 结束
 * event: done             // 全部完成，data: {"analysis":"...","preBattleSection":"..."}
 * event: error            // 流中途失败，data: {"code":"AI_..."}
 * </pre>
 * <p>写入失败的 {@link IOException}（客户端断开）向上传播，由 Controller 负责
 * 终止上游调用；任何成功写入的事件都会使 {@link #eventSent()} 变为 {@code true}，
 * 供 Controller 决定「稳定 HTTP 错误码」还是「error 事件」传达失败。</p>
 */
final class ReplaySseWriter {

    private final SseEmitter emitter;
    private boolean eventSent;

    ReplaySseWriter(final SseEmitter emitter) {
        this.emitter = emitter;
    }

    /** 是否已向客户端发送过至少一个事件（用于失败传达方式决策）。 */
    boolean eventSent() {
        return eventSent;
    }

    void stage(final String stage) throws IOException {
        send(stage, Map.of());
    }

    void token(final String delta) throws IOException {
        final Map<String, Object> data = new LinkedHashMap<>();
        data.put("delta", delta);
        send("call2_token", data);
    }

    void done(final AnalyzeResponse response) throws IOException {
        final Map<String, Object> data = new LinkedHashMap<>();
        data.put("analysis", response.analysis());
        data.put("preBattleSection", response.preBattleSection());
        send("done", data);
    }

    void error(final String code) throws IOException {
        send("error", Map.of("code", code));
    }

    private void send(final String event, final Map<String, Object> data) throws IOException {
        emitter.send(SseEmitter.event().name(event).data(data));
        eventSent = true;
    }
}
