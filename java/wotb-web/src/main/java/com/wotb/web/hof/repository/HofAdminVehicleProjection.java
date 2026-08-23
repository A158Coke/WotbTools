package com.wotb.web.hof.repository;

/** 名人堂已存在车辆的最小查询投影，属性由服务层车辆库补齐。 */
public interface HofAdminVehicleProjection {

    long getTankId();

    String getTankName();
}
