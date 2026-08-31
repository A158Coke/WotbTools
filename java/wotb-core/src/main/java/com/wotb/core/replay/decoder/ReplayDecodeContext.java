package com.wotb.core.replay.decoder;

/**
 * 解码上下文，包含本次解码共享的实体类证据和只读回放 metadata。
 *
 * <p>PR162 entity-class scoping：Context 携带每个解码 run 共享的 {@link EntityClassRegistry}。
 * 该 registry 由 MaterializationDecoder（Type5 entityTypeId→Vehicle/Other）与 EntityMethodDecoder /
 * VehicleModuleCrewStateDecoder（Avatar 化证明方法→Avatar）在解码过程中填充；
 * Type 8 语义分派前先经 {@code entityClassRegistry().resolve(entityId)} 解析实体类，UNKNOWN 则 raw-preserve。</p>
 *
 * @param replayVersion       回放 header 版本，仅作为输出 metadata，不参与 decoder 语义判断
 * @param entityClassRegistry 本解码 run 的实体类 registry（同一 context 内所有 decoder 共享）
 */
public record ReplayDecodeContext(
        String replayVersion,
        EntityClassRegistry entityClassRegistry
) {
    public ReplayDecodeContext() {
        this("", new EntityClassRegistry());
    }

    /** Compatibility constructor retaining the header version as metadata only. */
    public ReplayDecodeContext(final String replayVersion) {
        this(replayVersion, new EntityClassRegistry());
    }

    /** Compatibility constructor retaining the header version as metadata only. */
    public ReplayDecodeContext(final String replayVersion,
                               final EntityClassRegistry entityClassRegistry) {
        this.replayVersion = replayVersion == null ? "" : replayVersion;
        this.entityClassRegistry = entityClassRegistry == null ? new EntityClassRegistry() : entityClassRegistry;
    }

    public ReplayDecodeContext(final EntityClassRegistry entityClassRegistry) {
        this("", entityClassRegistry);
    }
}
