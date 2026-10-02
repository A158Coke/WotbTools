package com.wotb.web.config;

/**
 * API URL 常量的单一来源：{@link SecurityConfig} 的请求匹配器与各 Controller 的
 * 映射注解共用，避免同一路径在两处硬编码导致漂移。
 *
 * <p>命名约定：{@code API_*} 前缀为基础前缀（Controller 类级
 * {@code @RequestMapping} 使用），{@code *_PATTERN} 后缀为带 {@code /**} 通配的
 * 安全匹配模式（仅 SecurityConfig 使用），其余为精确端点。</p>
 */
public final class ApiPaths {

    private ApiPaths() {
    }

    // ---- 基础前缀 ----
    public static final String API = "/api";
    public static final String HOF = "/api/hof";
    public static final String USERS = "/api/users";
    public static final String ADMIN = "/api/admin";
    public static final String ADMIN_USERS = "/api/admin/users";
    public static final String HOF_ADMIN = "/api/admin/hof";
    public static final String HOF_HUNDRED = "/api/hof/hundred";
    public static final String HOF_HUNDRED_SUBMISSIONS = "/api/hof/hundred/submissions";
    public static final String USERS_HUNDRED = "/api/users/hundred";
    public static final String HOF_HUNDRED_ADMIN = "/api/admin/hof/hundred";
    public static final String HOF_MARK3 = "/api/hof/mark3";
    public static final String USERS_MARK3 = "/api/users/mark3";
    public static final String HOF_MARK3_ADMIN = "/api/admin/hof/mark3";

    // ---- 精确端点（SecurityConfig 与 Controller 共用） ----
    public static final String HOF_UPLOAD = "/api/hof/upload";
    public static final String HEALTH = "/api/health";

    // ---- 安全匹配模式（/** 通配，仅 SecurityConfig 使用） ----
    public static final String API_PATTERN = "/api/**";
    public static final String HOF_PATTERN = "/api/hof/**";
    public static final String HOF_REPLAY_PATTERN = "/api/hof/*/replay";
    public static final String HOF_ADMIN_PATTERN = "/api/admin/hof/**";
    public static final String HOF_HUNDRED_PATTERN = "/api/hof/hundred/**";
    public static final String HOF_HUNDRED_SUBMISSIONS_PATTERN = "/api/hof/hundred/submissions/**";
    public static final String HOF_MARK3_SUBMISSIONS_PATTERN = "/api/hof/mark3/submissions/**";
    public static final String USERS_PATTERN = "/api/users/**";
    public static final String ADMIN_USERS_PATTERN = "/api/admin/users/**";
    public static final String ADMIN_PATTERN = "/api/admin/**";
}
