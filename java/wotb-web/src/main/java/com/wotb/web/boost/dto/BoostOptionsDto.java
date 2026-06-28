package com.wotb.web.boost.dto;

import java.util.List;

/** 前端下拉选项合集。 */
public record BoostOptionsDto(
    List<OptionDto> regions,
    List<OptionDto> requestTypes,
    List<OptionDto> contactTypes,
    String warning
) {}
