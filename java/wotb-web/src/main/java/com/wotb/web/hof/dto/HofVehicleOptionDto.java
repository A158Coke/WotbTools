package com.wotb.web.hof.dto;

/** 名人堂车辆筛选选项（API 仅返回稳定英文枚举和显示名）。 */
public record HofVehicleOptionDto(
        long tankId,
        String tankName,
        String nation,
        String type,
        Integer tier
) {
}
