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
    public static final String USER_NOTIFICATIONS = "/api/users/notifications";
    public static final String BOOST = "/api/boost";
    public static final String BOOST_REQUESTS = "/api/boost/requests";
    public static final String BOOST_BOOSTERS = "/api/boost/boosters";
    public static final String BOOST_BOOSTER_APPLICATIONS = "/api/boost/booster-applications";
    public static final String BOOSTER = "/api/booster";
    public static final String ADMIN = "/api/admin";
    public static final String ADMIN_USERS = "/api/admin/users";
    public static final String ADMIN_BOOST = "/api/admin/boost";
    public static final String ADMIN_BOOST_REQUESTS = "/api/admin/boost/requests";
    public static final String ADMIN_BOOST_BOOSTERS = "/api/admin/boost/boosters";
    public static final String ADMIN_BOOST_BOOSTER_APPLICATIONS = "/api/admin/boost/booster-applications";
    public static final String ADMIN_BOOST_REQUEST_ASSIGNMENTS = "/api/admin/boost/requests/{id}/assignments";
    public static final String HOF_ADMIN = "/api/admin/hof";
    public static final String HOF_HUNDRED = "/api/hof/hundred";
    public static final String HOF_HUNDRED_SUBMISSIONS = "/api/hof/hundred/submissions";
    public static final String USERS_HUNDRED = "/api/users/hundred";
    public static final String HOF_HUNDRED_ADMIN = "/api/admin/hof/hundred";

    // ---- 精确端点（SecurityConfig 与 Controller 共用） ----
    public static final String HOF_UPLOAD = "/api/hof/upload";
    public static final String HEALTH = "/api/health";
    public static final String COLUMNS = "/api/columns";
    public static final String PERFORMANCE = "/api/performance";
    public static final String PREVIEW = "/api/preview";
    public static final String EXPORT = "/api/export";
    public static final String BOOST_OPTIONS = "/api/boost/options";
    public static final String REPLAY_ANALYZE = "/api/replay/analyze";
    public static final String REPLAY_ANALYZE_CANCEL = "/api/replay/analyze/cancel";
    public static final String REPLAY_MAP_OVERVIEW = "/api/replay/map-overview";
    public static final String REPLAY_RECONSTRUCT_BATCH = "/api/replay/reconstruct-batch";
    public static final String REPLAY_PROCESS = "/api/replay/process";

    // ---- 安全匹配模式（/** 通配，仅 SecurityConfig 使用） ----
    public static final String API_PATTERN = "/api/**";
    public static final String HOF_PATTERN = "/api/hof/**";
    public static final String HOF_REPLAY_PATTERN = "/api/hof/*/replay";
    public static final String HOF_ADMIN_PATTERN = "/api/admin/hof/**";
    public static final String HOF_HUNDRED_PATTERN = "/api/hof/hundred/**";
    public static final String HOF_HUNDRED_SUBMISSIONS_PATTERN = "/api/hof/hundred/submissions/**";
    public static final String USERS_PATTERN = "/api/users/**";
    public static final String BOOST_REQUESTS_PATTERN = "/api/boost/requests/**";
    public static final String BOOST_BOOSTERS_PATTERN = "/api/boost/boosters/**";
    public static final String BOOST_BOOSTER_APPLICATIONS_PATTERN = "/api/boost/booster-applications/**";
    public static final String BOOSTER_PATTERN = "/api/booster/**";
    public static final String ADMIN_USERS_PATTERN = "/api/admin/users/**";
    public static final String ADMIN_BOOST_PATTERN = "/api/admin/boost/**";
    public static final String ADMIN_PATTERN = "/api/admin/**";
    public static final String BOOST_LEGACY = "/boost";
    public static final String BOOST_LEGACY_PATTERN = "/boost/**";
}