package com.wotb.web.replayfile;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.facts.ReplayFactsCodec;
import org.springframework.util.StringUtils;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * 客户端提交的回放结算事实（服务器没有 parser）。
 *
 * <p>名人堂 / 百场 / 三环提交时，成绩事实的 creation authority 是<b>客户端本地解析</b>：浏览器用上游
 * Rust Core WASM（pin {@code deploy/agent/source.json}）解析 {@code .wotbreplay}，把结算事实按
 * {@link Battle} 形状（{@code frontend/src/replay-local/battleFacts.ts}，与已退役的 Java
 * {@code ReplayParser} 逐字段一致）随原始回放一并提交；原始回放只作证据附件存档。服务端只做
 * <b>结构校验</b>（identity / 数值 / 名册一致性），无法从字节重新验证事实，防伪造由管理员审核兜底。</p>
 */
public final class ClientReplayFacts {

    /** 单场名册结构上限（沿用已退役 Java {@code ReplayParser} 的 {@code MAX_PLAYERS_PER_REPLAY}） */
    static final int MAX_PLAYERS = 64;
    /** 单份 facts JSON 上限：14 名战斗者的结算事实远小于此 */
    static final int MAX_JSON_CHARS = 64 * 1024;

    private static final JsonMapper MAPPER = JsonMapper.builder().build();

    private ClientReplayFacts() {
    }

    /**
     * @throws IllegalArgumentException {@code INVALID_REPLAY_FACTS}（缺失 / 非法 JSON / 结构不合法）
     */
    public static Battle read(final String json) {
        if (!StringUtils.hasText(json) || json.length() > MAX_JSON_CHARS) {
            throw new IllegalArgumentException("INVALID_REPLAY_FACTS");
        }
        final Battle battle;
        try {
            final JsonNode node = MAPPER.readTree(json);
            if (node == null || !node.isObject()) {
                throw new IllegalArgumentException("INVALID_REPLAY_FACTS");
            }
            battle = ReplayFactsCodec.battleFromJson(node);
        } catch (final IllegalArgumentException e) {
            throw e;
        } catch (final Exception e) {
            throw new IllegalArgumentException("INVALID_REPLAY_FACTS");
        }
        validate(battle);
        return battle;
    }

    /**
     * 多文件提交：facts 与回放文件一一对应、同序。
     *
     * @throws IllegalArgumentException {@code REPLAY_FACTS_COUNT_MISMATCH} / {@code INVALID_REPLAY_FACTS}
     */
    public static List<Battle> readAll(final List<String> jsons, final int expectedCount) {
        if (jsons == null || jsons.size() != expectedCount) {
            throw new IllegalArgumentException("REPLAY_FACTS_COUNT_MISMATCH");
        }
        return jsons.stream().map(ClientReplayFacts::read).toList();
    }

    private static void validate(final Battle battle) {
        if (battle == null || !StringUtils.hasText(battle.arenaId) || !StringUtils.hasText(battle.recorder)
                || battle.players == null || battle.players.isEmpty() || battle.players.size() > MAX_PLAYERS) {
            throw new IllegalArgumentException("INVALID_REPLAY_FACTS");
        }
        final Set<Long> accounts = new HashSet<>();
        for (final PlayerResult p : battle.players) {
            if (p == null || p.accountId <= 0 || p.tankId <= 0 || (p.team != 1 && p.team != 2)
                    || p.damageDealt < 0 || !accounts.add(p.accountId)) {
                throw new IllegalArgumentException("INVALID_REPLAY_FACTS");
            }
            // 客户端投影不得携带原始 protobuf（只有解析器才有，也不应进入服务端）
            p.raw = null;
        }
        if (battle.recorderResult() == null) {
            throw new IllegalArgumentException("INVALID_REPLAY_FACTS");
        }
    }
}
