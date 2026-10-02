package com.wotb.web.replay.ai;

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
 * 冻结的客户端投影夹具（{@code common/fixtures/replay-facts}）：{@code common/fixtures/replays} 的回放在服务端 parser 退役前由
 * 迁移期工具（已随 parser 删除）冻结成 AI 服务生产入口接收的 JSON（{@code {battle, reconstruction}}），
 * 经与生产相同的 {@link ReplayFactsCodec} 解码。服务器没有 parser：AI 测试不再解析回放。
 */
final class ReplayFactsFixtures {

    /** 解码后的客户端投影 */
    record Facts(Battle battle, ReplayReconstruction reconstruction) {
    }

    private ReplayFactsFixtures() {
    }

    /**
     * 每次调用都解码新实例（不缓存）：调用方可能改写 Battle（enrichment），测试之间不得互相污染。
     *
     * @param fixture 夹具名，可带路径 / {@code .wotbreplay} 后缀（如 eval case 里的
     *                {@code common/fixtures/replays/random-battle-example.wotbreplay}）
     */
    static Facts load(final String fixture) {
        String name = fixture.substring(fixture.lastIndexOf('/') + 1);
        if (name.endsWith(".wotbreplay")) {
            name = name.substring(0, name.length() - ".wotbreplay".length());
        }
        return read(name);
    }

    private static Facts read(final String name) {
        final Path file = Path.of(System.getProperty("user.dir"), "..", "..", "common", "fixtures",
                "replay-facts", name + ".json.gz").normalize();
        try (InputStream in = new GZIPInputStream(Files.newInputStream(file))) {
            final JsonNode root = JsonMapper.builder().build().readTree(in);
            return new Facts(ReplayFactsCodec.battleFromJson(root.get("battle")),
                    ReplayFactsCodec.reconstructionFromJson(root.get("reconstruction")));
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }
}
