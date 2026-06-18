# Contributing

Thank you for your interest in contributing to atorage! Issues and PRs are welcome.

## Development Setup

- Node.js >= 18 (recommended: 22)
- pnpm >= 10

```bash
git clone https://github.com/ben-lau/atorage.git
cd atorage
pnpm install
pnpm build
```

## Common Commands

| Command              | Description                       |
| -------------------- | --------------------------------- |
| `pnpm build`         | Build (ESM + CJS)                 |
| `pnpm dev`           | Build in watch mode               |
| `pnpm test`          | Run tests                         |
| `pnpm test:coverage` | Run tests with coverage report    |
| `pnpm typecheck`     | TypeScript type checking          |
| `pnpm lint`          | Lint with oxlint                  |
| `pnpm fmt`           | Format with oxfmt                 |
| `pnpm fmt:check`     | Check formatting (no write)       |
| `pnpm publint`       | Check publish configuration       |
| `pnpm attw`          | Check type declaration resolution |
| `pnpm size:check`    | Check bundle size                 |
| `pnpm validate`      | Build + publint + attw            |

## Git Hooks

This project uses [lefthook](https://github.com/evilmartians/lefthook):

- **pre-commit**: Runs oxlint + oxfmt on staged files, auto-fixes are re-staged
- **commit-msg**: Validates commit message format via commitlint

Hooks are automatically installed when you run `pnpm install` (via the `prepare` script).

## Commit Convention

This project follows [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <description>
```

| Type     | Description             | Version Bump |
| -------- | ----------------------- | ------------ |
| feat     | New feature             | minor        |
| fix      | Bug fix                 | patch        |
| perf     | Performance improvement | patch        |
| refactor | Code refactoring        | none         |
| docs     | Documentation           | none         |
| test     | Tests                   | none         |
| chore    | Maintenance             | none         |
| ci       | CI/CD changes           | none         |

Available scopes: `core`, `drivers`, `middleware`, `debug`, `test`, `utils`, `ci`, `docs`, `release`, `deps`

## Release Process

This project uses [release-please](https://github.com/googleapis/release-please) for fully automated releases:

1. Merge conventional commits to `main`
2. release-please automatically creates/updates a Release PR with changelog
3. Review and merge the Release PR
4. A GitHub Release + tag is automatically created
5. npm publish is triggered automatically via OIDC (no token required)

## Pull Requests

1. Fork the repository and create a feature branch from `main`
2. Follow the commit conventions above
3. Ensure all checks pass: `pnpm validate && pnpm lint && pnpm fmt:check && pnpm typecheck && pnpm test`
4. Submit your PR
