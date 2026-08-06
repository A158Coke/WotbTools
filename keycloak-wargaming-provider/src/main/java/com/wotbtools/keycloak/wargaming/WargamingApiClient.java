package com.wotbtools.keycloak.wargaming;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;

/**
 * Wargaming.net API 客户端。Host 只来自 {@link WargamingRegion} 白名单
 * （认证 {@code /wot/auth/}、账号 {@code /wotb/account/}），不接受任何调用方传入的 URL。
 *
 * <p>安全约定：连接超时 5 秒、总请求超时 10 秒；token 不进入异常正文与日志；
 * 错误正文不回显给浏览器。</p>
 */
final class WargamingApiClient {

    private static final Duration CONNECT_TIMEOUT = Duration.ofSeconds(5);
    private static final Duration REQUEST_TIMEOUT = Duration.ofSeconds(10);

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final HttpClient http;
    private final URI authApiBase;
    private final URI accountApiBase;

    WargamingApiClient(final HttpClient http, final URI authApiBase, final URI accountApiBase) {
        this.http = http;
        this.authApiBase = authApiBase;
        this.accountApiBase = accountApiBase;
    }

    /**
     * 生产实例：按区服固定白名单 + 默认超时。区服必须来自 {@link WargamingRegion}，
     * 未知区服在编译期即不可表达，杜绝任意 host 注入。
     */
    static WargamingApiClient defaultClient(final WargamingRegion region) {
        if (region == null) {
            throw new IllegalArgumentException("Wargaming region must not be null");
        }
        final HttpClient http = HttpClient.newBuilder()
                .connectTimeout(CONNECT_TIMEOUT)
                .build();
        return new WargamingApiClient(http, region.authBase(), region.accountBase());
    }

    /**
     * 构造 WG 登录跳转地址（纯函数，便于单测）。
     *
     * @param applicationId WG 应用 ID
     * @param callbackUrl   Keycloak broker endpoint（含 state）
     * @param region        区服（决定白名单 host）
     */
    static String buildLoginUrl(final String applicationId, final String callbackUrl,
                                final WargamingRegion region) {
        if (region == null) {
            throw new IllegalArgumentException("Wargaming region must not be null");
        }
        return region.authBase().resolve("login/") + "?application_id=" + encode(applicationId)
                + "&redirect_uri=" + encode(callbackUrl)
                + "&nofollow=1";
    }

    /**
     * 拉取 WG 登录跳转地址（nofollow=1 时 WG 返回 JSON {@code url}，兼容 302 响应）。
     *
     * @throws WargamingApiException WG 拒绝或响应不可解析
     */
    String fetchLoginRedirectUrl(final String applicationId, final String callbackUrl) {
        final URI uri = URI.create(authApiBase.resolve("login/") + "?application_id="
                + encode(applicationId) + "&redirect_uri=" + encode(callbackUrl) + "&nofollow=1");
        final HttpRequest request = HttpRequest.newBuilder()
                .uri(uri)
                .GET()
                .timeout(REQUEST_TIMEOUT)
                .build();
        try {
            final HttpResponse<String> response =
                    http.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() == 302) {
                final String location = response.headers().firstValue("Location").orElse("");
                if (!location.isEmpty()) {
                    return location;
                }
                throw new WargamingApiException("WG login redirect missing Location");
            }
            if (response.statusCode() != 200) {
                throw new WargamingApiException(
                        "WG login returned HTTP " + response.statusCode());
            }
            final JsonNode json = parse(response.body());
            requireStatusOk(json);
            final String url = json.path("url").asText("");
            if (url.isEmpty()) {
                throw new WargamingApiException("WG login response missing url");
            }
            return url;
        } catch (final IOException | InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new WargamingApiException("WG login request failed", e);
        }
    }

    /**
     * 验证 token 有效性并刷新有效期，返回刷新后的 token。
     *
     * @throws WargamingApiException token 无效或 WG 服务错误
     */
    String prolongate(final String applicationId, final String accessToken) {
        final String body = postForm(authApiBase.resolve("prolongate/"),
                "application_id=" + encode(applicationId)
                        + "&access_token=" + encode(accessToken));
        final JsonNode json = parse(body);
        requireStatusOk(json);
        final String token = json.path("access_token").asText("");
        if (token.isEmpty()) {
            throw new WargamingApiException("WG prolongate response missing access_token");
        }
        return token;
    }

    /**
     * 查询 WoTB 官方账号资料，返回官方当前昵称。
     *
     * @throws WargamingApiException 接口失败或返回结果中没有该账号
     */
    String fetchOfficialNickname(final String applicationId, final long accountId) {
        final String accountIdText = Long.toString(accountId);
        final URI uri = URI.create(accountApiBase.resolve("info/") + "?application_id="
                + encode(applicationId) + "&account_id=" + accountIdText);
        final HttpRequest request = HttpRequest.newBuilder()
                .uri(uri)
                .GET()
                .timeout(REQUEST_TIMEOUT)
                .build();
        final String body = send(request);
        final JsonNode json = parse(body);
        requireStatusOk(json);
        final JsonNode account = json.path("data").path(accountIdText);
        final String nickname = account.path("nickname").asText("");
        if (nickname.isEmpty()) {
            throw new WargamingApiException("WG account/info did not return the account");
        }
        return nickname;
    }

    /** 立即销毁 WG token（尽力而为，失败由调用方记录不含 token 的安全警告）。 */
    void logout(final String applicationId, final String accessToken) {
        final String body = postForm(authApiBase.resolve("logout/"),
                "application_id=" + encode(applicationId)
                        + "&access_token=" + encode(accessToken));
        final JsonNode json = parse(body);
        requireStatusOk(json);
    }

    private String postForm(final URI uri, final String formBody) {
        final HttpRequest request = HttpRequest.newBuilder()
                .uri(uri)
                .header("Content-Type", "application/x-www-form-urlencoded")
                .POST(HttpRequest.BodyPublishers.ofString(formBody, StandardCharsets.UTF_8))
                .timeout(REQUEST_TIMEOUT)
                .build();
        return send(request);
    }

    private String send(final HttpRequest request) {
        try {
            final HttpResponse<String> response =
                    http.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() != 200) {
                throw new WargamingApiException("WG API returned HTTP " + response.statusCode());
            }
            return response.body();
        } catch (final IOException | InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new WargamingApiException("WG API request failed", e);
        }
    }

    private static JsonNode parse(final String body) {
        try {
            return MAPPER.readTree(body);
        } catch (final IOException e) {
            throw new WargamingApiException("WG API returned invalid JSON", e);
        }
    }

    private static void requireStatusOk(final JsonNode json) {
        if (!"ok".equals(json.path("status").asText(""))) {
            throw new WargamingApiException("WG API rejected the request");
        }
    }

    private static String encode(final String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }

    /** WG API 调用失败（消息不含 token / 原始正文）。 */
    static final class WargamingApiException extends RuntimeException {
        WargamingApiException(final String message) {
            super(message);
        }

        WargamingApiException(final String message, final Throwable cause) {
            super(message, cause);
        }
    }
}
