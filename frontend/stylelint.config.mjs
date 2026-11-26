import { readFileSync } from 'node:fs'

const legacy = JSON.parse(readFileSync(new URL('./stylelint.legacy.json', import.meta.url), 'utf8'))

const TOKEN_EXEMPT_VALUES = [
  'transparent', 'currentColor', 'currentcolor',
  'inherit', 'initial', 'unset', 'revert',
  'none', '0', 'auto', 'normal',
]

/** @type {import('stylelint').Config} */
export default {
  plugins: ['stylelint-declaration-strict-value'],
  ignoreFiles: legacy.files,
  rules: {
    'declaration-no-important': true,
    'scale-unlimited/declaration-strict-value': [
      ['/color$/', 'fill', 'stroke', 'z-index', 'font', 'font-size', 'line-height', 'border-radius', 'box-shadow'],
      { ignoreValues: TOKEN_EXEMPT_VALUES, disableFix: true },
    ],
    'color-no-hex': true,
    'color-named': 'never',
    'function-disallowed-list': ['rgb', 'rgba', 'hsl', 'hsla'],
    'media-feature-range-notation': 'context',
    'media-feature-name-value-allowed-list': { width: ['768px', '1200px'] },
    'media-feature-name-disallowed-list': ['min-width', 'max-width', 'device-width'],
    'declaration-property-unit-disallowed-list': {
      '/^(height|min-height|max-height|block-size|min-block-size|max-block-size|top|bottom|inset|inset-block|inset-block-start|inset-block-end)$/': ['vh'],
      '/^(width|min-width|max-width|inline-size|min-inline-size|max-inline-size)$/': ['vw'],
      'flex-basis': ['vh', 'vw'],
    },
  },
  overrides: [
    { files: ['**/*.vue'], customSyntax: 'postcss-html' },
    {
      files: ['src/styles/tokens/**/*.css'],
      rules: {
        'color-no-hex': null,
        'function-disallowed-list': null,
      },
    },
  ],
}
