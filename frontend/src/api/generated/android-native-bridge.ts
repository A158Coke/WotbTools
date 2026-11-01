// GENERATED FILE - DO NOT EDIT MANUALLY. Source: contracts/android-native-bridge.json
export type NativeBridgeCapability = 'native-auth' | 'replay-share' | 'replay-open' | 'app-update' | 'connectivity' | 'replay-folder-picker'

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
  authGetState: {
    request: Record<string, never>
    response: {
      authenticated: boolean
      expiresAt: number | null
    }
  }
  authLogin: {
    request: Record<string, never>
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
