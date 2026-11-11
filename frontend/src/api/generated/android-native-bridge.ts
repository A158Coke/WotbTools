// GENERATED FILE - DO NOT EDIT MANUALLY. Source: contracts/android-native-bridge.json
export type NativeBridgeCapability = 'native-auth' | 'replay-share' | 'replay-open' | 'app-update' | 'app-update-status' | 'connectivity' | 'replay-folder-picker' | 'screen-form' | 'haptics'

export interface NativeBridgeMethods {
  getBridgeVersion: {
    request: Record<string, never>
    response: number
  }
  getCapabilities: {
    request: Record<string, never>
    response: string[]
  }
  getPendingReplay: {
    request: Record<string, never>
    response: {
      pendingId: string
      name: string
      size: number
      uri: string
    } | null
  }
  consumePendingReplay: {
    request: {
      expectedPendingId: string
    }
    response: boolean
  }
  checkForUpdate: {
    request: Record<string, never>
    response: boolean
  }
  startUpdate: {
    request: Record<string, never>
    response: boolean
  }
  getUpdateStatus: {
    request: Record<string, never>
    response: {
      revision: number
      state: 'unknown' | 'checking' | 'upToDate' | 'optional' | 'mandatory' | 'checkFailed'
      checkState: 'idle' | 'checking' | 'succeeded' | 'failed'
      checkFailureReason: 'offline' | 'network' | 'invalidManifest' | null
      currentVersionName: string
      currentVersionCode: number
      latestVersionName: string | null
      latestVersionCode: number | null
      minSupportedVersionCode: number | null
      publishedAt: string | null
      releaseNotes: string | null
      optionalPromptSuppressed: boolean
      download: {
        taskToken: string | null
        versionName: string | null
        versionCode: number | null
        packageType?: 'full' | 'delta' | null
        state: 'idle' | 'queued' | 'downloading' | 'selectingPackage' | 'downloadingDelta' | 'verifyingDelta' | 'applyingDelta' | 'verifyingTargetApk' | 'fallbackFull' | 'paused' | 'verifying' | 'ready' | 'installRequested' | 'downloadFailed' | 'verifyFailed' | 'installPermissionRequired' | 'installRequestFailed'
        downloadedBytes: number | null
        totalBytes: number | null
        progressPercent: number | null
        failureReason: 'waitingNetwork' | 'waitingRetry' | 'waitingWifi' | 'pausedUnknown' | 'network' | 'http' | 'cannotResume' | 'insufficientStorage' | 'storageUnavailable' | 'fileIo' | 'taskMissing' | 'hashMismatch' | 'baseHashMismatch' | 'patchDownloadFailed' | 'patchHashMismatch' | 'patchApplyFailed' | 'targetHashMismatch' | 'artifactMissing' | 'unsupportedArtifact' | 'permissionDenied' | 'installerUnavailable' | 'unknown' | null
      }
    }
  }
  refreshUpdateStatus: {
    request: Record<string, never>
    response: {
      revision: number
      state: 'unknown' | 'checking' | 'upToDate' | 'optional' | 'mandatory' | 'checkFailed'
      checkState: 'idle' | 'checking' | 'succeeded' | 'failed'
      checkFailureReason: 'offline' | 'network' | 'invalidManifest' | null
      currentVersionName: string
      currentVersionCode: number
      latestVersionName: string | null
      latestVersionCode: number | null
      minSupportedVersionCode: number | null
      publishedAt: string | null
      releaseNotes: string | null
      optionalPromptSuppressed: boolean
      download: {
        taskToken: string | null
        versionName: string | null
        versionCode: number | null
        packageType?: 'full' | 'delta' | null
        state: 'idle' | 'queued' | 'downloading' | 'selectingPackage' | 'downloadingDelta' | 'verifyingDelta' | 'applyingDelta' | 'verifyingTargetApk' | 'fallbackFull' | 'paused' | 'verifying' | 'ready' | 'installRequested' | 'downloadFailed' | 'verifyFailed' | 'installPermissionRequired' | 'installRequestFailed'
        downloadedBytes: number | null
        totalBytes: number | null
        progressPercent: number | null
        failureReason: 'waitingNetwork' | 'waitingRetry' | 'waitingWifi' | 'pausedUnknown' | 'network' | 'http' | 'cannotResume' | 'insufficientStorage' | 'storageUnavailable' | 'fileIo' | 'taskMissing' | 'hashMismatch' | 'baseHashMismatch' | 'patchDownloadFailed' | 'patchHashMismatch' | 'patchApplyFailed' | 'targetHashMismatch' | 'artifactMissing' | 'unsupportedArtifact' | 'permissionDenied' | 'installerUnavailable' | 'unknown' | null
      }
    }
  }
  beginUpdateDownload: {
    request: {
      expectedLatestVersionCode: number
    }
    response: boolean
  }
  installUpdate: {
    request: {
      expectedTaskToken: string
    }
    response: boolean
  }
  dismissOptionalUpdate: {
    request: {
      expectedLatestVersionCode: number
    }
    response: boolean
  }
  authGetState: {
    request: Record<string, never>
    response: {
      authenticated: boolean
      expiresAt: number | null
    }
  }
  authLogin: {
    request: {
      locale?: 'zh' | 'en' | 'ru'
    }
    response: boolean
  }
  authLogout: {
    request: Record<string, never>
    response: boolean
  }
  authGetAccessToken: {
    request: {
      minValiditySeconds?: number
    }
    response: {
      token: string | null
      expiresAt: number | null
      claims: Record<string, unknown> | null
      error: string | null
    } | null
  }
  connectivityGetState: {
    request: Record<string, never>
    response: 'online' | 'offline'
  }
  pickReplayFolder: {
    request: {
      requestId: string
    }
    response: {
      status: 'selected' | 'cancelled' | 'failed'
      selectionId: string | null
      files: Array<{
        fileId: string
        name: string
        relativePath: string
        size: number | null
        lastModified: number
      }>
    }
  }
  cancelReplayFolderPicker: {
    request: {
      requestId: string
    }
    response: boolean
  }
  getScreenForm: {
    request: Record<string, never>
    response: {
      phone: boolean
    }
  }
  setOrientationLock: {
    request: {
      orientation: 'landscape' | 'portrait' | 'unspecified'
    }
    response: boolean
  }
  haptic: {
    request: {
      kind: 'selection' | 'primary' | 'success' | 'error' | 'endpoint'
    }
    response: boolean
  }
  releaseReplayFolderSelection: {
    request: {
      selectionId: string
    }
    response: boolean
  }
}

export type NativeBridgeMethod = keyof NativeBridgeMethods
export type NativeBridgeRequest<M extends NativeBridgeMethod> = NativeBridgeMethods[M]['request']
export type NativeBridgeResponse<M extends NativeBridgeMethod> = NativeBridgeMethods[M]['response']
