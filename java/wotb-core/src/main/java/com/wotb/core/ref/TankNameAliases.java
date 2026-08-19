package com.wotb.core.ref;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.io.InputStream;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;

/**
 * 坦克名称别名表（别名 -&gt; 权威名），单一来源 {@code common/tank-name-aliases.json}。
 * <p>AI 复盘正文生成后，把 LLM 常见的中文译名/俗称/缩写归一化为 tankopedia 权威英文名
 * （如 KRV/克朗瓦根 -&gt; Kranvagn、埃米尔1951 -&gt; EMIL 1951）。数据文件缺失或损坏时
 * 降级为空表（不阻断复盘，仅少做归一化）。</p>
 */
public final class TankNameAliases {

    private static final String RESOURCE = "/tank-name-aliases.json";

    private final Map<String, String> aliases;

    private TankNameAliases(final Map<String, String> aliases) {
        this.aliases = aliases;
    }

    /**
     * 从 classpath 加载别名表（与 {@link Tankopedia} 同模式）。
     */
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
            // 缺库/损坏时降级为空表
        }
        return new TankNameAliases(map);
    }

    /**
     * 别名 -&gt; 权威坦克名；非别名返回 {@code null}。
     */
    public String canonical(final String alias) {
        return aliases.get(alias);
    }

    /**
     * 全部别名键（用于正文扫描）。
     */
    public Set<String> aliases() {
        return aliases.keySet();
    }
}
