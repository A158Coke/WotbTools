package com.wotb.core.testsupport;

import com.wotb.core.model.Battle;
import com.wotb.core.replay.facts.ReplayFactsCodec;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.zip.GZIPInputStream;

/**
 * 冻结的客户端投影夹具（{@code common/fixtures/replay-facts/*.json.gz}）：服务端 parser 退役前把
 * {@code common/fixtures/replays} 冻结成 AI 服务生产入口接收的 {@code {battle, reconstruction}} JSON，
 * 经与生产相同的 {@link ReplayFactsCodec} 解码。服务器没有 parser：测试不再解析回放。
 * 每次调用都解码新实例（不缓存），测试之间不会经共享对象互相污染。
 */
public final class FrozenReplayFacts {

    /** 解码后的客户端投影 */
    public record Facts(Battle battle, ReplayReconstruction reconstruction) {
    }

    /** 夹具名（不带后缀），如 {@code random-battle-example} */
    public static final String RANDOM_BATTLE = "random-battle-example";

    private FrozenReplayFacts() {
    }

    public static Facts load(final String name) {
        final Path file = Path.of(System.getProperty("user.dir"), "..", "..", "common", "fixtures",
                "replay-facts", name + ".json.gz").normalize();
        try (InputStream in = new GZIPInputStream(Files.newInputStream(file))) {
            final JsonNode root = JsonMapper.builder().build().readTree(in);
            return new Facts(ReplayFactsCodec.battleFromJson(root.get("battle")),
                    ReplayFactsCodec.reconstructionFromJson(root.get("reconstruction")));
        } catch (IOException e) {
            throw new UncheckedIOException("frozen replay facts fixture missing/unreadable: " + file, e);
        }
    }
}
