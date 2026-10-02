package com.wotbtools.app.auth

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import android.util.Log
import org.json.JSONObject
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * AppAuth `AuthState` 的加密持久化（Android Keystore + AES-256-GCM）。
 *
 * ── 安全边界（这段是设计说明，不是可选项）──
 *  - **密钥**：AES-256-GCM 密钥只存在于 `AndroidKeyStore`（alias [KEY_ALIAS]），生成时用
 *    [KeyGenParameterSpec] 固定用途（GCM / 无 padding）且**不要求用户认证**（登录是后台刷新前提，
 *    要求解锁会把 refresh 变成随机失败）。密钥不可导出，进程内也拿不到原始字节。
 *  - **密文**：IV 与密文一起 base64 后存进 private `SharedPreferences`（[PREFS_NAME]，`MODE_PRIVATE`，
 *    且 manifest 关掉了 allowBackup，所以不会进云备份）。GCM 自带完整性校验：任何篡改/损坏都会在
 *    `doFinal` 抛 `AEADBadTagException`，而不是解出一段可疑明文。
 *  - **降级禁止**：解密失败、JSON 损坏、字段缺失、超时 → 直接**清空**该条目并当作未认证；
 *    绝不回退到明文存储、绝不「猜」出一个部分会话。
 *  - **日志**：只记分类 token（`auth-store cleared reason=...`）。token / claims / 授权码 / verifier
 *    一律不出现，密文与 IV 也不记录。
 *
 * 存进去的是完整 AppAuth `AuthState` JSON，因此 refresh token 与 PKCE verifier 只以密文形式落盘，
 * 永远不会经过 bridge；对外只有 [AuthSession] 这一份「无 refresh token」的投影。
 */
internal class AuthStateStore(context: Context) {

    /** 一次登录交易恢复出来的持久化快照。 */
    internal data class Entry(
        /** AppAuth `AuthState.jsonSerializeString()` 原文（仍为密文的明文形态，只在进程内存在）。 */
        val authStateJson: String,
        /** 本次交易实际使用的回程 URI —— 响应校验必须拿它比对，不能事后重新探测。 */
        val redirectUri: String,
        /**
         * 写入时刻（epoch millis）。只用于诊断 / 未来取证：**不参与任何失效判断**
         * （会话时效权威是 token 自身的 `exp`，见 [load]）。
         */
        val savedAtMillis: Long
    )

    private val prefs = context.applicationContext
        .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    /**
     * 读取并解密。任何异常路径都返回 null（同时清空条目），调用方据此当作未认证 ——
     * 这是唯一允许的失败姿态：不抛、不崩、不返回半成品。
     *
     * 刻意**不做**「存放过久即失效」的判断：会话的时效权威是 refresh token / access token 自身的
     * `exp`（过期后刷新会失败 → 自然回到未认证）。在这里加一刀时间上限只会把「长期活跃的合法会话」
     * 也一起踢下线，而 `savedAtMillis` 依然写盘、只用于诊断，不参与任何决策。
     */
    internal fun load(): Entry? {
        val stored = prefs.getString(KEY_PAYLOAD, null)
        if (stored.isNullOrBlank()) return null
        val entry = try {
            decrypt(stored)
        } catch (e: Exception) {
            clear(e.javaClass.simpleName)
            return null
        }
        if (entry == null) {
            clear("malformed")
            return null
        }
        return entry
    }

    /**
     * 写入加密快照。
     *
     * @return false 表示这次写入**没有**成功落盘（Keystore / JSON 异常）；此时旧条目也会被清空 ——
     *   绝不留下两份互相矛盾的会话，调用方必须按「未认证」处理，不能假装已登录。
     */
    internal fun save(entry: Entry): Boolean = try {
        val plain = JSONObject()
            .put(FIELD_AUTH_STATE, entry.authStateJson)
            .put(FIELD_REDIRECT_URI, entry.redirectUri)
            .put(FIELD_SAVED_AT, entry.savedAtMillis)
            .toString()
        prefs.edit().putString(KEY_PAYLOAD, encrypt(plain)).commit()
    } catch (e: Exception) {
        clear("save-failed:${e.javaClass.simpleName}")
        false
    }

    /**
     * 清空（logout / 任一失败路径）。幂等。
     *
     * 用 `commit()` 而不是 `apply()`：调用方紧接着可能返回「未认证」，而 `apply()` 是异步落盘，
     * 进程随后被杀就可能把已撤销的会话又留在磁盘上。
     */
    internal fun clear(reason: String = "requested") {
        if (prefs.contains(KEY_PAYLOAD)) prefs.edit().remove(KEY_PAYLOAD).commit()
        Log.d(TAG, "auth-store cleared reason=$reason")
    }

    private fun encrypt(plainText: String): String {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, secretKey())
        val ciphertext = cipher.doFinal(plainText.toByteArray(Charsets.UTF_8))
        return Base64.encodeToString(cipher.iv, Base64.NO_WRAP) + SEPARATOR +
            Base64.encodeToString(ciphertext, Base64.NO_WRAP)
    }

    private fun decrypt(stored: String): Entry? {
        val separator = stored.indexOf(SEPARATOR)
        if (separator <= 0) return null
        val iv = Base64.decode(stored.substring(0, separator), Base64.NO_WRAP)
        val ciphertext = Base64.decode(stored.substring(separator + 1), Base64.NO_WRAP)
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(GCM_TAG_BITS, iv))
        val plain = String(cipher.doFinal(ciphertext), Charsets.UTF_8)

        val json = JSONObject(plain)
        val authStateJson = json.optString(FIELD_AUTH_STATE, "")
        val redirectUri = json.optString(FIELD_REDIRECT_URI, "")
        // 只有真正参与决策的两个字段缺失才算「损坏」；savedAt 是诊断字段，缺了不影响可用性。
        if (authStateJson.isEmpty() || redirectUri.isEmpty()) return null
        return Entry(authStateJson, redirectUri, json.optLong(FIELD_SAVED_AT, 0L))
    }

    /**
     * 取密钥：存在就复用，不存在就生成（`setUserAuthenticationRequired(false)` —— 见类注释）。
     * 每次现取，不在字段里缓存 `SecretKey`：keystore 可能在系统事件后失效，缓存会拿到失效引用。
     */
    private fun secretKey(): SecretKey {
        val keyStore = KeyStore.getInstance(KEYSTORE_PROVIDER).apply { load(null) }
        (keyStore.getEntry(KEY_ALIAS, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }

        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE_PROVIDER)
        generator.init(
            KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(KEY_SIZE_BITS)
                .setUserAuthenticationRequired(false)
                .build()
        )
        return generator.generateKey()
    }

    private companion object {
        const val TAG = "WotbAuth"
        const val PREFS_NAME = "wotb_auth_state"
        const val KEY_PAYLOAD = "auth_state_v1"
        const val KEY_ALIAS = "wotbtools.auth.v1"
        const val KEYSTORE_PROVIDER = "AndroidKeyStore"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val KEY_SIZE_BITS = 256
        const val GCM_TAG_BITS = 128
        const val SEPARATOR = ":"

        const val FIELD_AUTH_STATE = "authState"
        const val FIELD_REDIRECT_URI = "redirectUri"
        const val FIELD_SAVED_AT = "savedAt"
    }
}
