package com.wotb.core.ref;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.io.InputStream;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;

public final class TankNameAliases {

    private static final String RESOURCE = "/tank-name-aliases.json";

    private final Map<String, String> aliases;

    private TankNameAliases(final Map<String, String> aliases) {
        this.aliases = aliases;
    }

    public static TankNameAliases load() {
        final Map<String, String> map = new LinkedHashMap<>();
        try (InputStream in = TankNameAliases.class.getResourceAsStream(RESOURCE)) {
            if (in != null) {
                final JsonNode root = JsonMapper.builder().build().readTree(in);
                final JsonNode list = root.get("aliases");
                if (list != null && list.isObject()) {
                    list.properties().forEach(entry -> {
                        final String alias = entry.getKey().trim();
                        final String canonical = entry.getValue().asText("").trim();
                        if (!alias.isEmpty() && !canonical.isEmpty()) {
                            map.put(alias, canonical);
                        }
                    });
                }
            }
        } catch (final Exception ignored) {
        }
        return new TankNameAliases(map);
    }

    public String canonical(final String alias) {
        return aliases.get(alias);
    }

    public Set<String> aliases() {
        return aliases.keySet();
    }
}
