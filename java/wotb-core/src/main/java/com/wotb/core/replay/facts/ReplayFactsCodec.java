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

public final class ReplayFactsCodec {

    private static final ObjectMapper MAPPER = buildMapper();

    private ReplayFactsCodec() {
    }

    public static com.wotb.core.replay.projection.ClientAiProjection projectionFromJson(final JsonNode node) throws IOException {
        if (node == null || !node.isObject()) {
            throw new IllegalArgumentException("projection missing");
        }
        rejectExplicitNullHpState(node);
        return PROJECTION_MAPPER.treeToValue(node, com.wotb.core.replay.projection.ClientAiProjection.class);
    }

    private static final ObjectMapper PROJECTION_MAPPER = JsonMapper.builder()
            .enable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
            .enable(DeserializationFeature.FAIL_ON_NULL_FOR_PRIMITIVES)
            .build();

    private static void rejectExplicitNullHpState(final JsonNode projection) {
        for (final String key : new String[] {"prop3Health", "healthEvents"}) {
            final JsonNode list = projection.get(key);
            if (list == null || !list.isArray()) {
                continue;
            }
            for (final JsonNode item : list) {
                if (item != null && item.isObject() && item.has("hpState") && item.get("hpState").isNull()) {
                    throw new IllegalArgumentException("projection." + key + "[].hpState 不可为 null（缺省才是 legacy 口径）");
                }
            }
        }
    }

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
                .disable(DeserializationFeature.FAIL_ON_NULL_FOR_PRIMITIVES)
                .changeDefaultVisibility(vc -> vc.withVisibility(
                        PropertyAccessor.FIELD, JsonAutoDetect.Visibility.ANY))
                .addModule(module)
                .build();
    }

    private static final class ReplayEventDeserializer extends StdDeserializer<ReplayEvent> {

        private ReplayEventDeserializer() {
            super(ReplayEvent.class);
        }

        @Override
        public ReplayEvent deserialize(final tools.jackson.core.JsonParser p,
                                       final DeserializationContext ctxt) {
            final JsonNode node = ctxt.readTree(p);
            final String type = node.path("type").asString("");
            final Class<?> clazz = EVENT_TYPES.get(type);
            if (clazz == null) {
                throw new IllegalArgumentException("Unknown ReplayEvent type: " + type);
            }
            final RecordComponent[] components = clazz.getRecordComponents();
            final Object[] args = new Object[components.length];
            for (int i = 0; i < components.length; i++) {
                final RecordComponent component = components[i];
                final JsonNode componentNode = node.get(component.getName());
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
