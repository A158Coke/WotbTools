package com.wotbtools.keycloak.juheqq;

import jakarta.ws.rs.core.Response;
import org.keycloak.broker.provider.AuthenticationRequest;
import org.keycloak.broker.provider.BrokeredIdentityContext;
import org.keycloak.broker.provider.UserAuthenticationIdentityProvider.AuthenticationCallback;
import org.keycloak.models.KeycloakContext;
import org.keycloak.models.KeycloakSession;
import org.keycloak.sessions.AuthenticationSessionModel;

import java.lang.reflect.InvocationHandler;
import java.lang.reflect.Method;
import java.lang.reflect.Proxy;
import java.util.HashMap;
import java.util.Map;

/**
 * 测试辅助：用 JDK 动态代理构造 Keycloak 接口的最小 fake（与 wargaming provider 同款风格）。
 */
final class JuheQqTestSupport {

    private JuheQqTestSupport() {
    }

    @SuppressWarnings("unchecked")
    static <T> T proxy(final Class<T> type, final InvocationHandler handler) {
        return (T) Proxy.newProxyInstance(
                JuheQqTestSupport.class.getClassLoader(), new Class<?>[]{type}, handler);
    }

    /** 返回固定值 / null 的通用 handler。 */
    static InvocationHandler constantHandler(final Map<String, Object> byName) {
        final Map<String, Object> values = new HashMap<>(byName);
        return (proxy, method, args) -> values.getOrDefault(method.getName(), defaultValue(method));
    }

    private static Object defaultValue(final Method method) {
        final Class<?> returnType = method.getReturnType();
        if (!returnType.isPrimitive()) {
            return null;
        }
        if (returnType == boolean.class) {
            return false;
        }
        if (returnType == int.class || returnType == long.class || returnType == short.class
                || returnType == byte.class || returnType == char.class) {
            return 0;
        }
        if (returnType == float.class || returnType == double.class) {
            return 0.0;
        }
        return null;
    }

    /** 认证回调 fake：仅当 state 匹配时返回会话，并捕获成功上下文。 */
    static final class AuthCallbackFake implements InvocationHandler {

        private final String validState;
        private final AuthenticationSessionModel session;
        BrokeredIdentityContext captured;

        AuthCallbackFake(final String validState) {
            this.validState = validState;
            this.session = proxy(AuthenticationSessionModel.class, constantHandler(Map.of()));
        }

        AuthenticationCallback callback() {
            return proxy(AuthenticationCallback.class, this);
        }

        @Override
        public Object invoke(final Object proxy, final Method method, final Object[] args) {
            switch (method.getName()) {
                case "getAndVerifyAuthenticationSession":
                    return validState.equals(args[0]) ? session : null;
                case "authenticated":
                    captured = (BrokeredIdentityContext) args[0];
                    return Response.ok().build();
                default:
                    return defaultValue(method);
            }
        }
    }

    /** KeycloakSession fake：getContext() 返回固定上下文。 */
    static KeycloakSession sessionWith(final KeycloakContext context) {
        return proxy(KeycloakSession.class, constantHandler(Map.of("getContext", context)));
    }

    /** KeycloakContext fake：realm/uri 等均返回 null 默认值。 */
    static KeycloakContext contextWith() {
        return proxy(KeycloakContext.class, constantHandler(Map.of()));
    }

    /**
     * AuthenticationRequest fake：getState() 返回 null（触发 performLogin 的 state_missing 分支）。
     * AuthenticationRequest 是具体类（JDK Proxy 仅支持接口），故走公开构造器；传入 state=null
     * 时 brokerState 为 null，生产代码对 null state 做防御性判空。
     */
    static AuthenticationRequest requestWithState(final String state) {
        return new AuthenticationRequest(null, null, null, null, null, null, null);
    }

    static JuheQqIdentityProviderConfig configWith(final String appid,
                                                   final String appkey,
                                                   final String loginBaseUrl) {
        final JuheQqIdentityProviderConfig config = new JuheQqIdentityProviderConfig();
        config.setEnabled(true);
        config.setAlias("juhe-qq");
        if (appid != null) {
            config.getConfig().put(JuheQqIdentityProviderConfig.CONFIG_APPID, appid);
        }
        if (appkey != null) {
            config.getConfig().put(JuheQqIdentityProviderConfig.CONFIG_APP_KEY, appkey);
        }
        if (loginBaseUrl != null) {
            config.getConfig().put(JuheQqIdentityProviderConfig.CONFIG_LOGIN_BASE_URL, loginBaseUrl);
        }
        return config;
    }

    static JuheQqIdentityProvider providerWith(final KeycloakSession session,
                                               final JuheQqIdentityProviderConfig config) {
        return new JuheQqIdentityProvider(session, config);
    }
}
