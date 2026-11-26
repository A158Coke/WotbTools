package com.wotb.web.config;

public final class ApiPaths {

    private ApiPaths() {
    }

    public static final String API = "/api";
    public static final String HOF = "/api/hof";
    public static final String USERS = "/api/users";
    public static final String ADMIN = "/api/admin";
    public static final String ADMIN_USERS = "/api/admin/users";
    public static final String ADMIN_BATTLE_DATA = ADMIN + "/battle-data";
    public static final String HOF_ADMIN = "/api/admin/hof";
    public static final String HOF_HUNDRED = "/api/hof/hundred";
    public static final String HOF_HUNDRED_SUBMISSIONS = "/api/hof/hundred/submissions";
    public static final String USERS_HUNDRED = "/api/users/hundred";
    public static final String HOF_HUNDRED_ADMIN = "/api/admin/hof/hundred";
    public static final String HOF_MARK3 = "/api/hof/mark3";
    public static final String USERS_MARK3 = "/api/users/mark3";
    public static final String HOF_MARK3_ADMIN = "/api/admin/hof/mark3";

    public static final String RECOMMENDATIONS = "/api/recommendations";
    public static final String RECOMMENDATIONS_ADMIN = "/api/admin/recommendations";
    public static final String RECOMMENDATIONS_ADMIN_PATTERN = RECOMMENDATIONS_ADMIN + "/**";
    public static final String CREATOR_AVATARS = "/api/creators/avatars";
    public static final String CREATOR_AVATAR = CREATOR_AVATARS + "/*";
    public static final String TOURNAMENTS = "/api/tournaments";
    public static final String TOURNAMENTS_ADMIN = "/api/admin/tournaments";
    public static final String TOURNAMENT_STANDINGS = "/api/tournaments/*/standings";
    public static final String TOURNAMENT_DATA_SOURCE = "/api/tournaments/*/data-source";
    public static final String BROADCASTS = "/api/tournament-broadcasts";
    public static final String BROADCASTS_ADMIN = "/api/admin/tournament-broadcasts";
    public static final String BROADCAST_SEASON = BROADCASTS + "/seasons/*";
    public static final String BROADCAST_SEASON_CONTENTS = BROADCASTS + "/seasons/*/contents";
    public static final String BROADCAST_CATEGORY = BROADCASTS + "/categories/*";
    public static final String BROADCAST_COVER = BROADCASTS + "/covers/*";

    public static final String HOF_UPLOAD = "/api/hof/upload";
    public static final String OBSERVABILITY_EVENTS = "/api/observability/events";
    public static final String BATTLE_DATA = "/api/battle-data";
    public static final String HEALTH = "/api/health";

    public static final String API_PATTERN = "/api/**";
    public static final String HOF_PATTERN = "/api/hof/**";
    public static final String HOF_REPLAY_PATTERN = "/api/hof/*/replay";
    public static final String HOF_ADMIN_PATTERN = "/api/admin/hof/**";
    public static final String HOF_HUNDRED_PATTERN = "/api/hof/hundred/**";
    public static final String HOF_HUNDRED_SUBMISSIONS_PATTERN = "/api/hof/hundred/submissions/**";
    public static final String HOF_MARK3_SUBMISSIONS_PATTERN = "/api/hof/mark3/submissions/**";
    public static final String USERS_PATTERN = "/api/users/**";
    public static final String ADMIN_USERS_PATTERN = "/api/admin/users/**";
    public static final String TOURNAMENTS_ADMIN_PATTERN = "/api/admin/tournaments/**";
    public static final String AI_REVIEW_FEEDBACK = "/api/ai-review-feedback";
    public static final String ADMIN_AI_REVIEW_FEEDBACK = "/api/admin/ai-review-feedback";
    public static final String SITE_FEEDBACK = "/api/site-feedback";
    public static final String ADMIN_SITE_FEEDBACK = "/api/admin/site-feedback";
    public static final String ADMIN_PATTERN = "/api/admin/**";
}
