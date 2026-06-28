package com.wotb.web.boost.enums;

/** 联系方式类型。 */
public enum ContactType {
    QQ("QQ"),
    WECHAT("微信");

    private final String label;

    ContactType(final String label) {
        this.label = label;
    }

    public String label() {
        return label;
    }

    public static ContactType from(final String value) {
        for (final ContactType c : values()) {
            if (c.name().equalsIgnoreCase(value)) {
                return c;
            }
        }
        throw new IllegalArgumentException("不支持的联系方式: " + value);
    }
}
