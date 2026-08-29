plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// 签名参由 CI（android-release.yml）经 -PwotbKeystore* 注入；本地无 key 时不配置 release 签名。
// 绝不把 keystore/口令写入仓库（规格 §21）。
val keystorePath = (project.findProperty("wotbKeystorePath") as String?)?.takeIf { it.isNotBlank() }
val keystoreStorePass = (project.findProperty("wotbKeystoreStorePass") as String?) ?: ""
val keyAlias = (project.findProperty("wotbKeyAlias") as String?) ?: ""
val keyPass = (project.findProperty("wotbKeyPass") as String?) ?: ""

android {
    namespace = "com.wotbtools.app"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.wotbtools.app"
        minSdk = 26
        targetSdk = 34
        // CI 通过 -PwotbVersionCode / -PwotbVersionName 注入真实版本，单一来源（见 docs/android/release-process）。
        versionCode = (project.findProperty("wotbVersionCode") as String?)?.toIntOrNull() ?: 1
        versionName = (project.findProperty("wotbVersionName") as String?) ?: "0.1.0"
    }

    signingConfigs {
        if (keystorePath != null) {
            create("release") {
                storeFile = file(keystorePath)
                storePassword = keystoreStorePass
                keyAlias = keyAlias
                keyPassword = keyPass
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
            if (keystorePath != null) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

dependencies {
    // Phase 2 极薄壳：WebView shell 只依赖 Android framework。后续 Phase 按需引入 androidx。
    implementation("androidx.core:core-ktx:1.13.1")
    // origin-scoped Native Bridge：WebView WebMessageListener（带 origin allowlist），
    // 替代 addJavascriptInterface 的全 frame 暴露。
    implementation("androidx.webkit:webkit:1.11.0")
}
