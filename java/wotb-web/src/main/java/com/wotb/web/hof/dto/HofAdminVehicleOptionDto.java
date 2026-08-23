package com.wotb.web.hof.dto;

/** 名人堂管理筛选用车辆选项（API 仅返回稳定英文枚举和显示名）。 */
public record HofAdminVehicleOptionDto(
        long tankId,
        String tankName,
        String nation,
        String type,
        Integer tier
) {
}
