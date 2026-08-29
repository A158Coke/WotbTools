package com.wotb.core.replay.facts;

import com.fasterxml.jackson.annotation.JsonAutoDetect;
import com.fasterxml.jackson.annotation.PropertyAccessor;
import com.wotb.core.replay.event.ReplayEvent;
import tools.jackson.databind.DeserializationContext;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.MapperFeature;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.deser.std.StdDeserializer;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.module.SimpleModule;
import tools.jackson.databind.ser.std.StdSerializer;

import java.io.IOException;
import java.lang.reflect.Constructor;
import java.lang.reflect.RecordComponent;
import java.util.Arrays;
import java.util.HashMap;
import java.util.Map;

/**
 * {@link AiReplayFacts} 的确定性 JSON 编解码（Jackson JSON，不做
 * 额外压缩）。ReplayEvent 是 sealed interface，用显式 type 标记做多态序列化；
 * 其余对象（record / Bean / public-field POJO / 枚举）由 Jackson 原生处理。
 */
public final class ReplayFactsCodec {

    private static final ObjectMapper MAPPER = buildMapper();

    private ReplayFactsCodec() {
    }

    public static JsonNode toJson(final AiReplayFacts facts) {
        return MAPPER.valueToTree(facts);
    }

    public static AiReplayFacts fromJson(final JsonNode node) throws IOException {
        return MAPPER.treeToValue(node, AiReplayFacts.class);
    }

    public static byte[] toBytes(final AiReplayFacts facts) {
        return MAPPER.writeValueAsBytes(facts);
    }

    public static AiReplayFacts fromBytes(final byte[] data) {
        return MAPPER.readValue(data, AiReplayFacts.class);
    }

    private static ObjectMapper buildMapper() {
        final SimpleModule module = new SimpleModule("replay-facts");
        module.addSerializer(ReplayEvent.class, new ReplayEventSerializer());
        module.addDeserializer(ReplayEvent.class, new ReplayEventDeserializer());
        return JsonMapper.builder()
                .enable(MapperFeature.ALLOW_FINAL_FIELDS_AS_MUTATORS)
                .changeDefaultVisibility(vc -> vc.withVisibility(
                        PropertyAccessor.FIELD, JsonAutoDetect.Visibility.ANY))
                .addModule(module)
                .build();
    }

    /** ReplayEvent → {"type": <简单类名>, <record 组件>...}。 */
    private static final class ReplayEventSerializer extends StdSerializer<ReplayEvent> {

        private ReplayEventSerializer() {
            super(ReplayEvent.class);
        }

        @Override
        public void serialize(final ReplayEvent value,
                              final tools.jackson.core.JsonGenerator gen,
                              final tools.jackson.databind.SerializationContext ctxt) {
            gen.writeStartObject();
            gen.writeName("type");
            gen.writeString(value.getClass().getSimpleName());
            for (final RecordComponent component : value.getClass().getRecordComponents()) {
                gen.writeName(component.getName());
                final Object componentValue;
                try {
                    componentValue = component.getAccessor().invoke(value);
                } catch (final ReflectiveOperationException e) {
                    throw new IllegalStateException("record accessor failed: " + component.getName(), e);
                }
                ctxt.writeValue(gen, componentValue);
            }
            gen.writeEndObject();
        }
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
                args[i] = MAPPER.convertValue(componentNode, component.getType());
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
