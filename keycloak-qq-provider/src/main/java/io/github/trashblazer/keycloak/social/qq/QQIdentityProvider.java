/*
 * Copyright 2026 Trashblazer
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

package io.github.trashblazer.keycloak.social.qq;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import org.keycloak.broker.oidc.AbstractOAuth2IdentityProvider;
import org.keycloak.broker.provider.BrokeredIdentityContext;
import org.keycloak.broker.provider.IdentityBrokerException;
import org.keycloak.broker.social.SocialIdentityProvider;
import org.keycloak.http.simple.SimpleHttp;
import org.keycloak.models.KeycloakSession;

public class QQIdentityProvider
        extends AbstractOAuth2IdentityProvider<QQIdentityProviderConfig>
        implements SocialIdentityProvider<QQIdentityProviderConfig> {

    private static final String AUTH_URL = "https://graph.qq.com/oauth2.0/authorize";

    private static final String TOKEN_URL = "https://graph.qq.com/oauth2.0/token?fmt=json&need_openid=1";

    private static final String ME_URL = "https://graph.qq.com/oauth2.0/me";

    private static final String USER_INFO_URL = "https://graph.qq.com/user/get_user_info";

    private static final ObjectMapper MAPPER = new ObjectMapper();

    public QQIdentityProvider(KeycloakSession session,
            QQIdentityProviderConfig config) {
        super(session, config);

        config.setAuthorizationUrl(AUTH_URL);
        config.setTokenUrl(TOKEN_URL);
    }

    @Override
    protected BrokeredIdentityContext doGetFederatedIdentity(String accessToken) {

        try {
            // =========================
            // 1️⃣ 获取 openid
            // =========================
            String meResponse = SimpleHttp.create(session)
                    .doGet(ME_URL)
                    .param("access_token", accessToken)
                    .param("fmt", "json")
                    .asString();

            JsonNode meNode = MAPPER.readTree(meResponse);

            if (!meNode.hasNonNull("openid") || meNode.get("openid").asText().isBlank()) {
                throw new IdentityBrokerException("QQ did not return a valid openid");
            }

            String openid = meNode.get("openid").asText();

            // =========================
            // 2️⃣ 获取用户信息
            // =========================
            JsonNode userInfo = SimpleHttp.create(session)
                    .doGet(USER_INFO_URL)
                    .param("access_token", accessToken)
                    .param("oauth_consumer_key", getConfig().getClientId())
                    .param("openid", openid)
                    .asJson();

            if (userInfo == null || !userInfo.has("ret") || userInfo.get("ret").asInt() != 0) {
                throw new IdentityBrokerException("QQ user information request was rejected");
            }

            String nickname = userInfo.has("nickname")
                    ? userInfo.get("nickname").asText()
                    : "qq_user";
            if (nickname == null || nickname.isBlank()) {
                nickname = "qq_user";
            }
            if (nickname.length() > 50) {
                nickname = nickname.substring(0, 50);
            }

            String avatar = userInfo.has("figureurl_qq_2")
                    ? userInfo.get("figureurl_qq_2").asText()
                    : null;

            // =========================
            // 3️⃣ 构造 BrokeredIdentityContext
            // =========================
            BrokeredIdentityContext context = new BrokeredIdentityContext(getConfig());

            context.setId(openid);
            context.setBrokerUserId(openid);

            // 建议用户名
            context.setUsername("qq_" + openid);

            context.setFirstName(nickname);
            context.setUserAttribute("displayName", nickname);
            context.setUserAttribute("region", "CN");

            // QQ 默认没有邮箱，这里给一个占位邮箱
            // context.setEmail(openid + "@qq.social.local");

            if (avatar != null) {
                context.setUserAttribute("avatar", avatar);
            }

            context.setIdp(this);
            context.setToken(accessToken);

            return context;

        } catch (IdentityBrokerException e) {
            throw e;
        } catch (Exception e) {
            throw new IdentityBrokerException("QQ login failed");
        }
    }

    @Override
    protected String getDefaultScopes() {
        return "get_user_info";
    }
}
