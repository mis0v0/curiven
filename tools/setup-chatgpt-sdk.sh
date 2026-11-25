#!/bin/sh
# Installs OpenAI's official Sign in with ChatGPT DevKit SDK (@siwc/local) for CURIVEN.
# @siwc/local is not published to npm; it is built from the official repository at a pinned commit.
# Installs outside the CURIVEN repository (the DevKit uses a noncommercial licence; CURIVEN does not
# vendor or redistribute it). Only the @siwc/local workspace's dependencies are installed, with
# install scripts disabled; the Electron example app and its dependencies are not installed.
set -eu
REPO=https://github.com/openai/sign-in-with-chatgpt-devkit.git
COMMIT=0a36fefeb913055c8c7a1a29b63d82b96b2e841a
DEST="${CURIVEN_SIWC_DIR:-$HOME/.local/opt/siwc-devkit-0a36fef}"

command -v node >/dev/null || { echo "Node.js 22.12+ is required" >&2; exit 1; }
node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=12)?0:1)' || { echo "Node.js 22.12+ is required" >&2; exit 1; }

if [ ! -d "$DEST/.git" ]; then git clone --quiet "$REPO" "$DEST"; fi
cd "$DEST"
git fetch --quiet origin
git -c advice.detachedHead=false checkout --quiet "$COMMIT"
[ "$(git rev-parse HEAD)" = "$COMMIT" ] || { echo "unexpected commit" >&2; exit 1; }
[ -z "$(git status --porcelain)" ] || { echo "$DEST has local modifications; refusing to build" >&2; exit 1; }

npm ci -w @siwc/local --include-workspace-root --ignore-scripts --no-audit --no-fund
npm run build -w @siwc/local
node --experimental-strip-types --test packages/local/test/*.test.mjs
echo "Installed @siwc/local at $DEST (commit $COMMIT)"
