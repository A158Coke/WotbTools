package com.wotb.web.util.admission;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Clock;
import java.util.HashMap;
import java.util.HexFormat;
import java.util.Map;
import java.util.UUID;

/** 单实例固定分钟配额；来源仅以每分钟轮换的 hash 保留在有界内存中。 */
public final class AnonymousAdmission {
    private final Clock clock;
    private final int perSource;
    private final int global;
    private final int maxKeys;
    private final Map<String, Integer> sources = new HashMap<>();
    private long minute = Long.MIN_VALUE;
    private String salt;
    private int total;

    public AnonymousAdmission(final Clock clock, final int perSource, final int global, final int maxKeys) {
        if (perSource < 1 || global < 1 || maxKeys < 1) {
            throw new IllegalArgumentException("Admission bounds must be positive");
        }
        this.clock = clock;
        this.perSource = perSource;
        this.global = global;
        this.maxKeys = maxKeys;
    }

    public synchronized boolean tryAcquire(final String source, final int cost) {
        if (cost < 1) { throw new IllegalArgumentException("Admission cost must be positive"); }
        final long current = clock.millis() / 60_000;
        if (current != minute) {
            sources.clear();
            total = 0;
            salt = UUID.randomUUID().toString();
            minute = current;
        }
        if (cost > global - total) { return false; }
        final String key = sourceKey(source);
        final int count = sources.getOrDefault(key, 0);
        if (cost > perSource - count || (!sources.containsKey(key) && sources.size() >= maxKeys)) {
            return false;
        }
        sources.put(key, count + cost);
        total += cost;
        return true;
    }

    private String sourceKey(final String source) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest((salt + ":" + source).getBytes(StandardCharsets.UTF_8)));
        } catch (final NoSuchAlgorithmException exception) {
            throw new IllegalStateException("Source hashing unavailable");
        }
    }
}
