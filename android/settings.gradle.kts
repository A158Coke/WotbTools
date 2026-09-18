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
