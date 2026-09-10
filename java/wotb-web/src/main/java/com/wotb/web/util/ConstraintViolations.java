package com.wotb.web.util;

/**
 * 数据库约束冲突的成因判定。
 *
 * <p>唯一约束冲突被 Spring 统一包装成 {@link org.springframework.dao.DataIntegrityViolationException}，
 * 但同一个异常类型可能来自**语义完全不同**的约束：例如 user_profile 上
 * {@code user_profile_keycloak_user_id_key}（同一 Keycloak 用户的并发创建，可幂等收敛）与
 * {@code uk_user_profile_wotb_account}（同一 WotB 账号已被他人绑定，是必须暴露的业务冲突）。
 *
 * <p>把二者混为一谈就会把真实身份冲突吞成「幂等成功」，因此调用方必须按约束名精确判定，
 * 而不是对整个 {@code DataIntegrityViolationException} 一概而论。</p>
 */
public final class ConstraintViolations {

    private ConstraintViolations() {
    }

    /**
     * 异常链（含 cause）中是否提到指定约束名。
     *
     * <p>PostgreSQL 的约束名只出现在驱动异常的消息文本里，没有结构化字段可读，
     * 因此这里做的是文本包含判定；约束名取值必须来自实际 schema（Flyway 迁移中的显式
     * 约束名，或 PostgreSQL 对内联 UNIQUE 生成的 {@code <table>_<column>_key}）。</p>
     */
    public static boolean causedByConstraint(final Throwable failure, final String constraintName) {
        Throwable current = failure;
        while (current != null) {
            final String message = current.getMessage();
            if (message != null && message.contains(constraintName)) {
                return true;
            }
            current = current.getCause();
        }
        return false;
    }
}
