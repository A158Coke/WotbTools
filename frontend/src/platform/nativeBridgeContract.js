// The JSON contract is authoritative. This is the FE compatibility declaration;
// CI fails if it drifts from contracts/android-native-bridge.json.
export const SUPPORTED_NATIVE_BRIDGE_VERSIONS = Object.freeze([1])

export const LEGACY_NATIVE_BRIDGE_REQUIRED_CAPABILITIES = Object.freeze([
  'replay-open',
  'replay-share',
])

// PR290 legacy Native clients expose the replay only through this same-origin
// HTTPS resource. Older content:// pending entries are not compatible with
// the browser-side import contract.
export const LEGACY_PR290_REPLAY_RESOURCE_URL =
  'https://wotbtools.com/__native/replay-pending'
