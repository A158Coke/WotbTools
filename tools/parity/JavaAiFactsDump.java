import com.fasterxml.jackson.annotation.JsonAutoDetect;
import com.fasterxml.jackson.annotation.JsonTypeInfo;
import com.fasterxml.jackson.annotation.PropertyAccessor;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.model.Source;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.facts.ReplayFactsCodec;
import com.wotb.core.replay.processing.DefaultReplayProcessingFacade;
import com.wotb.core.replay.processing.ReplayProcessingOptions;
import com.wotb.core.replay.processing.ReplayProcessingResult;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.MapperFeature;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.zip.GZIPOutputStream;

/**
 * 迁移期一次性工具：用即将删除的 Java 解析 + 重建链路，把 AI 测试用的 fixture 回放冻结成
 * AI 服务生产入口接收的客户端投影 JSON（{@code {battle, reconstruction}}，{@link ReplayFactsCodec} 解码）。
 * 冻结后 wotb-ai 的测试不再依赖服务端 parser。写出前做「编码 → 解码 → 再编码」无损自检。
 *
 * <p>用法：{@code java -cp <coordinator classpath> JavaAiFactsDump.java <replay> <out.json.gz>}</p>
 */
public class JavaAiFactsDump {

    @JsonTypeInfo(use = JsonTypeInfo.Id.SIMPLE_NAME, include = JsonTypeInfo.As.PROPERTY, property = "type")
    interface ReplayEventTypeTag {
    }

    public static void main(String[] args) throws Exception {
        final Path replay = Path.of(args[0]);
        final Path out = Path.of(args[1]);
        final ReplayProcessingResult r = new DefaultReplayProcessingFacade().process(
                new Source(replay.getFileName().toString(), Files.readAllBytes(replay)),
                ReplayProcessingOptions.full());
        if (r.battle() == null || r.reconstruction() == null) {
            throw new IllegalStateException("parse/reconstruct failed: " + r.error());
        }
        for (final PlayerResult p : r.battle().players) {
            p.raw = null; // 客户端投影不携带原始 protobuf
        }
        final ObjectMapper mapper = JsonMapper.builder()
                .enable(MapperFeature.ALLOW_FINAL_FIELDS_AS_MUTATORS)
                .changeDefaultVisibility(vc -> vc.withVisibility(PropertyAccessor.FIELD, JsonAutoDetect.Visibility.ANY)
                        .withVisibility(PropertyAccessor.GETTER, JsonAutoDetect.Visibility.NONE)
                        .withVisibility(PropertyAccessor.IS_GETTER, JsonAutoDetect.Visibility.NONE))
                .addMixIn(ReplayEvent.class, ReplayEventTypeTag.class)
                .build();
        final ObjectNode root = mapper.createObjectNode();
        root.set("battle", mapper.valueToTree(r.battle()));
        root.set("reconstruction", mapper.valueToTree(r.reconstruction()));

        // 无损自检：ReplayFactsCodec 解码后再编码必须得到同一份 JSON 文本（byte[] 在树里是二进制节点、
        // 解码后再编码前是 base64 文本节点，所以比文本不比节点类型）
        final JsonNode again = mapper.createObjectNode()
                .set("battle", mapper.valueToTree(ReplayFactsCodec.battleFromJson(root.get("battle"))));
        ((ObjectNode) again).set("reconstruction",
                mapper.valueToTree(ReplayFactsCodec.reconstructionFromJson(root.get("reconstruction"))));
        final ObjectNode reparsed = (ObjectNode) mapper.readTree(mapper.writeValueAsString(root));
        if (!mapper.readTree(mapper.writeValueAsString(again)).equals(reparsed)) {
            final java.util.List<String> diffs = new java.util.ArrayList<>();
            diff("", reparsed, mapper.readTree(mapper.writeValueAsString(again)), diffs);
            throw new IllegalStateException("round-trip mismatch for " + replay + ": " + diffs);
        }
        try (var gz = new GZIPOutputStream(Files.newOutputStream(out))) {
            mapper.writeValue(gz, root);
        }
        System.out.println("ai facts: " + replay.getFileName() + " -> " + out + " (" + Files.size(out) + " bytes)");
    }

    private static void diff(final String path, final JsonNode a, final JsonNode b, final java.util.List<String> out) {
        if (out.size() >= 8 || a.equals(b)) return;
        if (a.isObject() && b.isObject()) {
            final java.util.Set<String> keys = new java.util.TreeSet<>();
            a.propertyNames().forEach(keys::add);
            b.propertyNames().forEach(keys::add);
            for (final String k : keys) diff(path + "." + k, a.path(k), b.path(k), out);
        } else if (a.isArray() && b.isArray() && a.size() == b.size()) {
            for (int i = 0; i < a.size(); i++) diff(path + "[" + i + "]", a.get(i), b.get(i), out);
        } else {
            final String as = String.valueOf(a), bs = String.valueOf(b);
            out.add(path + " : " + as.substring(0, Math.min(120, as.length())) + " -> " + bs.substring(0, Math.min(120, bs.length())));
        }
    }
}
