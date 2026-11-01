#!/usr/bin/env bash
# End-to-end test: real browser → production build → real Code.gs logic (mock Google services)
set -u
cd "$(dirname "$0")/.."
rm -rf dist
VITE_APPS_SCRIPT_URL=http://localhost:8787 GITHUB_REPOSITORY=user/krishibazar-ai npx vite build >/dev/null 2>&1 || { echo "build failed"; exit 1; }
node e2e/mock-backend.mjs >/tmp/e2e-backend.log 2>&1 &
BACK=$!
GITHUB_REPOSITORY=user/krishibazar-ai npx vite preview --port 4173 --host 127.0.0.1 >/tmp/e2e-preview.log 2>&1 &
PREV=$!
trap 'kill $BACK $PREV 2>/dev/null' EXIT
for i in $(seq 1 30); do
  curl -s -o /dev/null http://127.0.0.1:4173/krishibazar-ai/ && curl -s -o /dev/null http://localhost:8787 && break
  sleep 1
done
node e2e/flow.mjs && node e2e/admin.mjs && node e2e/regressions.mjs
