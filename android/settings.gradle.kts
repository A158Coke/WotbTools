import org.gradle.api.initialization.resolve.RepositoriesMode

pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        // GeckoView 只允许来自 Mozilla 官方仓库；exclusiveContent 同时禁止其它仓库（含 Aliyun 回退）提供该 group。
        exclusiveContent {
            forRepository {
                maven {
                    name = "MozillaMaven"
                    url = uri("https://maven.mozilla.org/maven2/")
                }
            }
            filter { includeGroup("org.mozilla.geckoview") }
        }
        google()
        mavenCentral()
        maven {
            name = "AliyunPublicFallback"
            url = uri("https://maven.aliyun.com/repository/public")
        }
    }
}

rootProject.name = "WotbToolsAndroid"
include(":app")
