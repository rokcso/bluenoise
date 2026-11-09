#!/usr/bin/env sh
# One quality gate, run locally, in hooks, and in CI.
#
# The order matters: formatting and linting are cheap, so they fail first and
# fast; the build is last because it is the slowest and catches wiring mistakes
# (a wrong asset path, a manifest field) that no unit test can see.
#
# Usage: pnpm verify

set -e

echo '==> lint + format'
pnpm check

echo '==> typecheck (app + tests)'
pnpm typecheck

echo '==> unit tests'
pnpm test

echo '==> build extension'
pnpm build

echo '==> all checks passed'
