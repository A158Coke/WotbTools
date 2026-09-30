package com.wotb.core.replay.facts;

import com.fasterxml.jackson.annotation.JsonAutoDetect;
import com.fasterxml.jackson.annotation.PropertyAccessor;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.model.Battle;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import tools.jackson.databind.DeserializationContext;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.MapperFeature;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.deser.std.StdDeserializer;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.module.SimpleModule;

import java.io.IOException;
import java.lang.reflect.Constructor;
import java.lang.reflect.RecordComponent;
import java.util.Arrays;
import java.util.HashMap;
import java.util.Map;

/**
 * 客户端投影（{@code Battle} + {@code ReplayReconstruction}）的确定性 JSON 解码（Jackson JSON，
 * 不做额外压缩）。{@link ReplayEvent} 是 sealed interface，其 {@code {"type": <简单类名>}}
 * 标记由本类显式反序列化；其余对象（record / Bean / public-field POJO / 枚举）由 Jackson
 * 原生处理。
 *
 * <p>只保留解码方向：AI Review 的写入侧（stored facts）已随 artifact 一起移除，standalone
 * ai-service（{@code com.wotb.ai.AiReviewController}）只消费客户端投影的请求体。</p>
 */
public final class ReplayFactsCodec {

    private static final ObjectMapper MAPPER = buildMapper();

    private ReplayFactsCodec() {
    }

    /** Decodes the browser projection using the same ReplayEvent type registry as the wire contract. */
    public static Battle battleFromJson(final JsonNode node) throws IOException {
        return MAPPER.treeToValue(node, Battle.class);
    }

    public static ReplayReconstruction reconstructionFromJson(final JsonNode node) throws IOException {
        return MAPPER.treeToValue(node, ReplayReconstruction.class);
    }

    private static ObjectMapper buildMapper() {
        final SimpleModule module = new SimpleModule("replay-facts");
        module.addDeserializer(ReplayEvent.class, new ReplayEventDeserializer());
        return JsonMapper.builder()
                .enable(MapperFeature.ALLOW_FINAL_FIELDS_AS_MUTATORS)
                // 输入是外部客户端投影（browser Rust/WASM）：无法确定的原始类型字段可能为 null，
                // 回落 primitive 默认值，而不是让整个 AI 请求因一个字段判为非法。
                .disable(DeserializationFeature.FAIL_ON_NULL_FOR_PRIMITIVES)
                .changeDefaultVisibility(vc -> vc.withVisibility(
                        PropertyAccessor.FIELD, JsonAutoDetect.Visibility.ANY))
                .addModule(module)
                .build();
    }

    /** {"type": ...} → 具体 ReplayEvent record（canonical constructor + 组件类型转换）。 */
    private static final class ReplayEventDeserializer extends StdDeserializer<ReplayEvent> {

        private ReplayEventDeserializer() {
            super(ReplayEvent.class);
        }

        @Override
        public ReplayEvent deserialize(final tools.jackson.core.JsonParser p,
                                       final DeserializationContext ctxt) {
            final JsonNode node = ctxt.readTree(p);
            final String type = node.path("type").asText();
            final Class<?> clazz = EVENT_TYPES.get(type);
            if (clazz == null) {
                throw new IllegalArgumentException("Unknown ReplayEvent type: " + type);
            }
            final RecordComponent[] components = clazz.getRecordComponents();
            final Object[] args = new Object[components.length];
            for (int i = 0; i < components.length; i++) {
                final RecordComponent component = components[i];
                final JsonNode componentNode = node.get(component.getName());
                // 必须用 generic type，而不是擦除后的 raw Class：否则 List<ComponentResult> /
                // List<Integer> 这类泛型 record 组件会被解成 List<LinkedHashMap>，下游按具体类型
                // 遍历时抛 ClassCastException（如 PlayerEvidenceFormatter 的 ShotResultEvent.components()）。
                args[i] = MAPPER.convertValue(componentNode,
                        MAPPER.getTypeFactory().constructType(component.getGenericType()));
            }
            try {
                final Constructor<?> ctor = clazz.getDeclaredConstructor(
                        Arrays.stream(components).map(RecordComponent::getType).toArray(Class[]::new));
                ctor.setAccessible(true);
                return (ReplayEvent) ctor.newInstance(args);
            } catch (final ReflectiveOperationException e) {
                throw new IllegalArgumentException("record construction failed: " + clazz.getSimpleName(), e);
            }
        }
    }

    /** sealed interface permits 自动枚举（不硬编码类型名清单）。 */
    private static final Map<String, Class<?>> EVENT_TYPES = buildEventTypes();

    private static Map<String, Class<?>> buildEventTypes() {
        final Map<String, Class<?>> map = new HashMap<>();
        final Class<?>[] permitted = ReplayEvent.class.getPermittedSubclasses();
        if (permitted != null) {
            for (final Class<?> type : permitted) {
                map.put(type.getSimpleName(), type);
            }
        }
        return Map.copyOf(map);
    }
}
