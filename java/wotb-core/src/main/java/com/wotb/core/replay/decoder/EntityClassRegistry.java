package com.wotb.core.replay.decoder;

import java.util.HashMap;
import java.util.Map;

/**
 * 实体的 entityId → 协议类 轻量 registry。
 *
 * <p>只记录真实生命周期证据（不靠 method-shape 反推）：
 * <ul>
 *   <li>{@link #markVehicle}：来源于 MaterializationEvent.entityTypeId==2（combat vehicle）。</li>
 *   <li>{@link #markAvatar}：来源于<b>独立的录像者账号身份</b> —— method48 参与映射（entity→account）
 *       中映射到录像者 accountId 的实体；由 reconstruction 的 prepass 建立。这是账号身份证据，
 *       不是「method numeric → class」的循环推断。</li>
 *   <li>{@link #markOther}：来源于 MaterializationEvent.entityTypeId==3（static family）。</li>
 * </ul>
 * </p>
 *
 * <p>置信规则：{@code AVATAR} 是粘性的（覆盖 Vehicle/O'her）——录像者 Avatar 实体同时具有载具物理性质与
 * 单独的协议 Avatar 角色，方法分派必须按 Avatar 走；{@code VEHICLE}/{@code OTHER} 只在 UNKNOWN 时写入，
 * 绝不把已证明的 Avatar 降级。无法证明的 entityId 保持 {@link EntityClass#UNKNOWN}，此时 Type8 必须
 * raw-preserve（见 EntityMethodDecoder）。</p>
 */
public final class EntityClassRegistry {

    private final Map<Integer, EntityClass> byId = new HashMap<>();

    /** 物化 entityTypeId==2 = combat vehicle → VEHICLE（不覆盖已证明的 Avatar）。 */
    public void markVehicle(final int entityId) {
        byId.merge(entityId, EntityClass.VEHICLE,
                (current, vehicle) -> current == EntityClass.AVATAR || current == EntityClass.OTHER
                        ? current : EntityClass.VEHICLE);
    }

    /** Avatar 化证明（subtype48/49 等）→ AVATAR（粘性，覆盖 Vehicle）。 */
    public void markAvatar(final int entityId) {
        byId.put(entityId, EntityClass.AVATAR);
    }

    /** 物化 entityTypeId==3 = static family → OTHER（不覆盖已证明的 Avatar）。 */
    public void markOther(final int entityId) {
        byId.putIfAbsent(entityId, EntityClass.OTHER);
    }

    /** 当前已证明的实体类；无证据 → UNKNOWN。 */
    public EntityClass resolve(final int entityId) {
        return byId.getOrDefault(entityId, EntityClass.UNKNOWN);
    }

    /** 是否有可信类证据（非 UNKNOWN）。 */
    public boolean isClassified(final int entityId) {
        return resolve(entityId) != EntityClass.UNKNOWN;
    }
}
