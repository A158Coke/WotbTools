/** 业务模块的跨模块依赖边界。 */
@org.springframework.modulith.ApplicationModule(allowedDependencies = {
        "config", "user :: api", "util"
})
package com.wotb.web.admin;
