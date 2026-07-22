package com.wotb.web.replay.ai;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.wotb.core.replay.feature.BattleFeatureSet;
import com.wotb.core.replay.feature.DefaultBattleFeatureExtractor;
import com.wotb.core.replay.feature.KeyBattleEvent;
import com.wotb.core.replay.reconstruction.BattleParticipant;
import com.wotb.core.replay.reconstruction.BattleStateSnapshot;
import com.wotb.core.replay.reconstruction.ReplayMetadata;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import com.wotb.core.replay.reconstruction.VehicleState;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestClientResponseException;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 回放 AI 战术复盘服务。
 * <p>
 * 从完整重建结果提取关键特征，构建紧凑的战局摘要，调用 DeepSeek
 * （OpenAI 兼容的 {@code /chat/completions}）生成中文战术复盘。
 * </p>
 * <p>密钥来自环境变量 {@code AI_API_KEY}（见 application.yml 的 wotb.ai.*）；
 * 未配置时 {@link #analyze} 抛出 {@code AI_NOT_CONFIGURED}，应用本身仍可正常启动。</p>
 */
@Service
public class AiReplayAnalysisService {

    private static final String SYSTEM_PROMPT = """
            你是《坦克世界闪击战》(WoT Blitz) 的资深教练。
            下面给出一场战斗的重建数据（地图、参战车辆的输出/承伤/存活、关键事件时间线）。
            请用简体中文输出一份简洁、专业、可执行的战术复盘：
            1) 用一两句话概述战局走势与胜负；
            2) 指出 2-3 个关键转折点（结合关键事件时间线）；
            3) 评估录像者(recorder)的表现与主要失误；
            4) 给出 3-5 条具体、可操作的改进建议。
            严格基于给定数据，不要编造数据中不存在的信息；无法判断时明确说明。""";

    private final String apiKey;
    private final String model;
    private final RestClient restClient;
    private final DefaultBattleFeatureExtractor featureExtractor = new DefaultBattleFeatureExtractor();

    public AiReplayAnalysisService(
            @Value("${wotb.ai.api-key:}") String apiKey,
            @Value("${wotb.ai.base-url:https://api.deepseek.com}") String baseUrl,
            @Value("${wotb.ai.model:deepseek-chat}") String model,
            @Value("${wotb.ai.timeout-sec:120}") int timeoutSec) {
        this.apiKey = apiKey == null ? "" : apiKey.trim();
        this.model = model;

        final SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(10_000);
        factory.setReadTimeout(Math.max(1, timeoutSec) * 1000);
        this.restClient = RestClient.builder()
                .baseUrl(baseUrl)
                .requestFactory(factory)
                .build();
    }

    /** 是否已配置 AI 密钥。 */
    public boolean isConfigured() {
        return !apiKey.isBlank();
    }

    /**
     * 对单场重建结果生成战术复盘。
     *
     * @throws IllegalStateException 未配置密钥（消息 {@code AI_NOT_CONFIGURED}）
     * @throws AiUpstreamException   上游调用失败或返回异常
     */
    public AnalyzeResult analyze(ReplayReconstruction reconstruction) {
        if (!isConfigured()) {
            throw new IllegalStateException("AI_NOT_CONFIGURED");
        }

        final BattleFeatureSet features =
                featureExtractor.extract(reconstruction, reconstruction.finalState());
        final String summary = buildSummary(reconstruction, features);

        final Map<String, Object> requestBody = new LinkedHashMap<>();
        requestBody.put("model", model);
        requestBody.put("stream", false);
        requestBody.put("messages", List.of(
                Map.of("role", "system", "content", SYSTEM_PROMPT),
                Map.of("role", "user", "content", summary)));

        final ChatCompletionResponse response;
        try {
            // 由 RestClient（Spring Boot 4.1 默认 Jackson 3 转换器）直接反序列化为类型化 record，
            // 不手动使用 ObjectMapper，规避 Jackson 2/3 版本混用。
            response = restClient.post()
                    .uri("/chat/completions")
                    .header("Authorization", "Bearer " + apiKey)
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(requestBody)
                    .retrieve()
                    .body(ChatCompletionResponse.class);
        } catch (RestClientResponseException e) {
            // 上游返回 4xx/5xx —— 只暴露状态码，绝不回显密钥或响应体
            throw new AiUpstreamException("AI_UPSTREAM_ERROR: HTTP " + e.getStatusCode().value());
        } catch (RestClientException e) {
            // 连接/超时/反序列化失败等
            throw new AiUpstreamException("AI_UPSTREAM_ERROR: " + e.getClass().getSimpleName());
        }

        final String content = extractContent(response);
        if (content.isBlank()) {
            throw new AiUpstreamException("AI_EMPTY_RESPONSE");
        }
        return new AnalyzeResult(content, model, features);
    }

    private static String extractContent(ChatCompletionResponse response) {
        if (response == null || response.choices() == null || response.choices().isEmpty()) {
            return "";
        }
        final ChatCompletionResponse.Choice choice = response.choices().get(0);
        if (choice == null || choice.message() == null || choice.message().content() == null) {
            return "";
        }
        return choice.message().content();
    }

    /** 构建紧凑的战局摘要文本（不包含数万条原始事件）。 */
    private static String buildSummary(ReplayReconstruction reconstruction, BattleFeatureSet features) {
        final BattleStateSnapshot finalState = reconstruction.finalState();
        final ReplayMetadata meta = reconstruction.metadata();

        // 账号 → 参与者 映射（用于补充昵称/坦克）
        final Map<Long, BattleParticipant> byAccount = new HashMap<>();
        for (final BattleParticipant p : reconstruction.participants()) {
            byAccount.put(p.accountId(), p);
        }

        final StringBuilder sb = new StringBuilder(1024);
        sb.append("地图: ").append(meta != null && meta.mapName() != null ? meta.mapName() : "未知").append('\n');
        if (meta != null && meta.arenaBonusType() != null) {
            sb.append("模式编号: ").append(meta.arenaBonusType()).append('\n');
        }
        sb.append("时长: ").append(String.format("%.1f", reconstruction.replayDurationSec())).append("s\n");
        sb.append("结束状态: ")
                .append(finalState.lifecycle() != null ? finalState.lifecycle().name() : "UNKNOWN");
        if (finalState.winnerTeam() != null) {
            sb.append(", 胜方队伍: ").append(finalState.winnerTeam());
        }
        sb.append('\n');
        if (meta != null && meta.recorder() != null && !meta.recorder().isBlank()) {
            sb.append("录像者: ").append(meta.recorder());
            if (meta.recorderVehicle() != null) {
                sb.append(" (").append(meta.recorderVehicle()).append(')');
            }
            sb.append('\n');
        }

        sb.append("\n参战车辆 (按实体):\n");
        final List<VehicleState> vehicles = new ArrayList<>(finalState.vehiclesByEntityId().values());
        vehicles.sort((a, b) -> Integer.compare(
                a.team() != null ? a.team() : 0, b.team() != null ? b.team() : 0));
        for (final VehicleState v : vehicles) {
            final BattleParticipant p = v.accountId() != null ? byAccount.get(v.accountId()) : null;
            sb.append("- 队伍").append(v.team() != null ? v.team() : "?")
                    .append(" EID").append(v.entityId());
            if (p != null) {
                if (p.nickname() != null && !p.nickname().isBlank()) {
                    sb.append(" [").append(p.nickname()).append(']');
                }
                if (p.tankCode() != null && !p.tankCode().isBlank()) {
                    sb.append(' ').append(p.tankCode());
                }
                if (p.recorder()) {
                    sb.append(" (录像者)");
                }
            }
            sb.append(" 输出").append(v.damageDealt())
                    .append(" 承伤").append(v.damageReceived());
            if (v.currentHealth() != null && v.maxHealth() != null) {
                sb.append(" 血量").append(v.currentHealth()).append('/').append(v.maxHealth());
            }
            sb.append(" 状态").append(v.lifeState() != null ? v.lifeState().name() : "UNKNOWN");
            if (v.destroyedAt() != null) {
                sb.append(" 阵亡@").append(String.format("%.1f", v.destroyedAt())).append('s');
            }
            sb.append('\n');
        }

        sb.append("\n关键事件时间线:\n");
        if (features.keyEvents().isEmpty()) {
            sb.append("(无)\n");
        } else {
            for (final KeyBattleEvent e : features.keyEvents()) {
                sb.append("- [").append(String.format("%.1f", e.clockSec())).append("s] ")
                        .append(e.type()).append(' ').append(e.label()).append('\n');
            }
        }

        return sb.toString();
    }

    /**
     * 分析结果。
     *
     * @param analysis AI 生成的战术复盘文本
     * @param model    使用的模型
     * @param features 提取的战斗特征（含关键事件）
     */
    public record AnalyzeResult(String analysis, String model, BattleFeatureSet features) {
    }

    /**
     * DeepSeek /chat/completions 响应的最小映射（OpenAI 兼容）。
     * 忽略未知字段，避免上游新增字段导致反序列化失败。
     */
    @JsonIgnoreProperties(ignoreUnknown = true)
    record ChatCompletionResponse(List<Choice> choices) {

        @JsonIgnoreProperties(ignoreUnknown = true)
        record Choice(Message message) {
        }

        @JsonIgnoreProperties(ignoreUnknown = true)
        record Message(String content) {
        }
    }
}
