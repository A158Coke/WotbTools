package com.wotbtools.keycloak.wargaming;

import jakarta.ws.rs.core.Response;
import org.keycloak.broker.provider.BrokeredIdentityContext;
import org.keycloak.broker.provider.UserAuthenticationIdentityProvider.AuthenticationCallback;
import org.keycloak.models.KeycloakContext;
import org.keycloak.models.KeycloakSession;
import org.keycloak.models.UserModel;
import org.keycloak.sessions.AuthenticationSessionModel;

import java.lang.reflect.InvocationHandler;
import java.lang.reflect.Method;
import java.lang.reflect.Proxy;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 测试辅助：用 JDK 动态代理构造 Keycloak 接口的最小 fake，避免引入 Mockito。
 */
final class KeycloakFakes {

    private KeycloakFakes() {
    }

    @SuppressWarnings("unchecked")
    static <T> T proxy(final Class<T> type, final InvocationHandler handler) {
        return (T) Proxy.newProxyInstance(
                KeycloakFakes.class.getClassLoader(), new Class<?>[]{type}, handler);
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

    /** KeycloakContext fake：端点/Realm 均不需要时使用。 */
    static KeycloakContext contextWith() {
        return proxy(KeycloakContext.class, constantHandler(Map.of()));
    }

    /** UserModel fake：记录 setSingleAttribute 调用。 */
    static final class UserModelFake implements InvocationHandler {

        final Map<String, String> attributes = new LinkedHashMap<>();

        UserModel user() {
            return proxy(UserModel.class, this);
        }

        @Override
        public Object invoke(final Object proxy, final Method method, final Object[] args) {
            if ("setSingleAttribute".equals(method.getName())) {
                attributes.put((String) args[0], (String) args[1]);
                return null;
            }
            return defaultValue(method);
        }
    }

}
