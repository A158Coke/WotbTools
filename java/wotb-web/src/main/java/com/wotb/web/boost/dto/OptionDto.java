package com.wotb.web.boost.dto;

/** 下拉选项。 */
public record OptionDto(
    String value,
    String label,
    Boolean enabled
) {}
