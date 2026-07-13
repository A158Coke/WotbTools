package com.wotb.web.boost.enums;

/** 联系方式类型。 */
public enum ContactType {
    QQ,
    WECHAT;

    public static ContactType from(final String value) {
        for (final ContactType c : values()) {
            if (c.name().equalsIgnoreCase(value)) {
                return c;
            }
        }
        throw new IllegalArgumentException("UNKNOWN_CONTACT_TYPE");
    }
}
