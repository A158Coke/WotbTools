package com.wotb.web.dto;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.InputStream;
import java.util.Collections;
import java.util.HashMap;
import java.util.Map;

/**
 * 错误码工具。从 classpath:error-codes.json 加载。
 * JSON 是唯一源头，Java 和前端共用。
 */
public final class ErrorCodes {

    private static final Logger log = LoggerFactory.getLogger(ErrorCodes.class);
    private static final Map<String, String> CODES = load();

    public static final String CONFIRMATION_REQUIRED = "CONFIRMATION_REQUIRED";
    public static final String CANNOT_DELETE_SELF = "CANNOT_DELETE_SELF";
    public static final String USER_HAS_DEPENDENCIES = "USER_HAS_DEPENDENCIES";
    public static final String FAILED_LOCAL_DELETE = "FAILED_LOCAL_DELETE";
    public static final String FAILED_KEYCLOAK_DELETE = "FAILED_KEYCLOAK_DELETE";
    public static final String KEYCLOAK_USER_NOT_FOUND = "KEYCLOAK_USER_NOT_FOUND";
    public static final String FORBIDDEN = "FORBIDDEN";

    private ErrorCodes() {}

    private static Map<String, String> load() {
        try (InputStream in = ErrorCodes.class.getResourceAsStream("/error-codes.json")) {
            if (in == null) {
                log.warn("error-codes.json not found on classpath, using empty defaults");
                return Collections.emptyMap();
            }
            return Collections.unmodifiableMap(
                    new ObjectMapper().readValue(in, new TypeReference<HashMap<String, String>>() {}));
        } catch (final Exception e) {
            log.error("Failed to load error-codes.json", e);
            return Collections.emptyMap();
        }
    }

    /** 获取错误码的默认消息。 */
    public static String message(final String code) {
        return CODES.getOrDefault(code, "Unknown error.");
    }
}
