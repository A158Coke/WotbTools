package com.wotb.core.replay.decoder;

/**
 * 实体协议类（entity-class scoped）。
 *
 * <p>Type 8（EntityMethod）与 Type 7（EntityProperty）的 method/property 编号不是全局语义；
 * 同一 methodId 在不同实体类上有不兼容的语义（见 docs/research/replay/entity-routing.md）。
 * 因此语义分派必须用 {@code (entityClass, methodId, argShape)}，而 {@code entityClass}
 * 只能来自<b>真实的生命周期证据</b>（MaterializationEvent.entityTypeId、Avatar 化的证明方法），
 * 不得由 methodId+argLen 反推。</p>
 *
 * <ul>
 *   <li>{@link #VEHICLE}：战场载具实体（MaterializationEvent.entityTypeId==2 证明）。</li>
 *   <li>{@link #AVATAR}：录像者 Avatar 实体（Avatar 化证明方法，如 subtype48/49，证明）。</li>
 *   <li>{@link #OTHER}：已证明是其它类（如 static family，entityTypeId==3）。</li>
 *   <li>{@link #UNKNOWN}：无可信类证据 —— 此时 Type 8 到达必须 raw-preserve，不得借用其它类语义。</li>
 * </ul>
 */
public enum EntityClass {
    VEHICLE,
    AVATAR,
    OTHER,
    UNKNOWN
}
