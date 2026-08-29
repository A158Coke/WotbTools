package com.wotb.core.replay.decoder;

/**
 * 解码上下文，包含游戏版本等信息，供 decoder 决策使用。
 *
 * <p>PR162 entity-class scoping：Context 携带每个解码 run 共享的 {@link EntityClassRegistry}。
 * 该 registry 由 MaterializationDecoder（Type5 entityTypeId→Vehicle/Other）与 EntityMethodDecoder /
 * VehicleModuleCrewStateDecoder（Avatar 化证明方法→Avatar）在解码过程中填充；
 * Type 8 语义分派前先经 {@code entityClassRegistry().resolve(entityId)} 解析实体类，UNKNOWN 则 raw-preserve。</p>
 *
 * @param clientVersion      客户端版本号字符串
 * @param entityClassRegistry 本解码 run 的实体类 registry（同一 context 内所有 decoder 共享）
 */
public record ReplayDecodeContext(
        String clientVersion,
        EntityClassRegistry entityClassRegistry
) {
    /** 兼容现有单参构造：为每个 context 新建一个空的实体类 registry。 */
    public ReplayDecodeContext(String clientVersion) {
        this(clientVersion, new EntityClassRegistry());
    }
}
