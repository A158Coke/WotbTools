package com.wotb.web.admin.dto;

import java.util.List;

/**
 * 批量删除用户请求。
 *
 * <p>{@code confirm} 与单用户删除的 {@code ?confirm=true} 是同一业务规则的显式确认位：
 * 缺失或为 false 时整个批次以 400 {@code CONFIRMATION_REQUIRED} 拒绝，不执行任何删除。</p>
 */
public record BulkDeleteUsersRequest(List<String> userIds, boolean confirm) {
}
