#!/usr/bin/env bash
# Stage, commit, push to origin, then deploy production on Vercel.
# Usage: ./push.sh "feat: short message"
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

die() {
  printf '%s\n' "$*" >&2
  exit 1
}

usage() {
  die 'Usage: ./push.sh "commit message"'
}

[[ $# -eq 1 ]] || usage
msg=$1
[[ -n "${msg// }" ]] || usage

command -v git >/dev/null || die "git is required"
command -v npx >/dev/null || die "npx is required"

git rev-parse --is-inside-work-tree >/dev/null 2>&1 || die "not a git repository"

git add -A -- .

staged_env=""
staged_env=$(git diff --cached --name-only | grep -E '(^|/)\.env' | grep -v '\.env\.example$' || true)
if [[ -n "$staged_env" ]]; then
  die "refusing to commit env files (keep them gitignored):"$'\n'"${staged_env}"
fi

if git diff --cached --quiet; then
  printf 'Nothing to commit.\n' >&2
else
  git commit -m "$msg"
fi

git rev-parse --verify HEAD >/dev/null 2>&1 || die "no commits to push"

git remote get-url origin >/dev/null 2>&1 || die "git remote origin is not set"

git push -u origin HEAD

printf 'Deploying production…\n' >&2
# Prefer the installed CLI. `npx vercel` can keep a stale cached release.
if command -v vercel >/dev/null 2>&1; then
  vercel deploy --prod --yes
else
  npx --yes vercel@latest deploy --prod --yes
fi
