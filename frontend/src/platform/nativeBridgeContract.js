// The JSON contract is authoritative. This is the FE compatibility declaration;
// CI fails if it drifts from contracts/android-native-bridge.json.
export const SUPPORTED_NATIVE_BRIDGE_VERSIONS = Object.freeze([1])

export const LEGACY_NATIVE_BRIDGE_REQUIRED_CAPABILITIES = Object.freeze([
  'replay-open',
  'replay-share',
])
