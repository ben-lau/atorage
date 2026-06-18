export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'scope-enum': [
      2,
      'always',
      ['core', 'drivers', 'middleware', 'debug', 'test', 'utils', 'ci', 'docs', 'release', 'deps'],
    ],
    'scope-empty': [1, 'never'],
    'subject-max-length': [2, 'always', 100],
  },
  prompt: {
    scopes: [
      { value: 'core', name: 'core: Core logic' },
      { value: 'drivers', name: 'drivers: Storage drivers' },
      { value: 'middleware', name: 'middleware: Middleware' },
      { value: 'debug', name: 'debug: Debug tools' },
      { value: 'test', name: 'test: Test utilities' },
      { value: 'utils', name: 'utils: Utility functions' },
      { value: 'ci', name: 'ci: CI/CD workflows' },
      { value: 'docs', name: 'docs: Documentation' },
      { value: 'release', name: 'release: Release related' },
      { value: 'deps', name: 'deps: Dependency updates' },
    ],
    enableMultipleScopes: true,
    scopeEnumSeparator: ',',
  },
};
