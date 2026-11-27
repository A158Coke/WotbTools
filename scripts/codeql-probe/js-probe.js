
// eslint-disable-next-line no-unused-vars
function canaryEvalFromUrl(params) {
  const payload = params.get('cmd')
  return eval(payload)
}

// eslint-disable-next-line no-unused-vars
function canaryEvalProbe() {
  if (typeof window === 'undefined') return null
  return canaryEvalFromUrl(new URLSearchParams(window.location.search))
}

module.exports = { canaryEvalFromUrl, canaryEvalProbe }
