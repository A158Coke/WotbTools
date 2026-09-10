package com.wotb.web.user.service;

/**
 * 用户当前绑定的 canonical WotB 业务身份。
 *
 * <p>区服是业务身份的一部分，不是可省略的展示字段：{@code (CN, 123456)} 与 {@code (EU, 123456)}
 * 是两个不同账号，只按账号 ID 归属会造成跨服 ownership / authorization 串号。
 * 该组合与 {@code user_profile} 的 {@code UNIQUE (wotb_server, wotb_account_id)} 完全一致。</p>
 *
 * <p>该记录是 HoF ownership 的唯一解析出口：各业务域必须通过当前绑定 profile 解析本身份，
 * 不得按 Keycloak 身份自行推断归属。</p>
 *
 * @param server 区服（CN / ASIA / EU / NA）
 * @param accountId WotB 游戏账号 ID
 */
public record WotbAccountIdentity(String server, long accountId) {
}
