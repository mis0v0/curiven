# CURIVEN

CURIVEN is a personal learning application with a Korean interface. It stores explanations and learning records in the browser. Backups, exported notes and published pages can contain the learner’s complete text.

## Run locally

On macOS with a supported Python 3.12 patch release, run `python3 server.py` and open `http://127.0.0.1:8765`. The server uses the Python standard library. PDF extraction uses Swift and PDFKit. Use a current browser and a separate browser profile for test data. The application is designed for a single user on loopback.

To try a sample without a provider, start with `CURIVEN_DEV_TOOLS=1 python3 server.py` and import the included sample lesson JSON in the developer tools. For optional ChatGPT connectivity, review the upstream Sign-in with ChatGPT DevKit noncommercial license and the installer before running `sh tools/setup-chatgpt-sdk.sh`. It downloads a pinned SDK separately and requires Node 22.12 or newer, npm, Git and a macOS login Keychain. Model requests send the selected learning context to the provider. Notion publishing is optional and requires its own credentials and destination. Treat both integrations as external disclosures.

## Offline tests

Install macOS command-line tools separately if needed. Generate the synthetic PDF test inputs locally. They contain typeset educational examples and rectangles representing scanned pages.

```sh
build_dir=$(mktemp -d)
swiftc tests/fixtures/material/make_pdfs.swift -o "$build_dir/make-pdfs"
"$build_dir/make-pdfs" tests/fixtures/material
export CURIVEN_TEST=1 PYTHONDONTWRITEBYTECODE=1
python3 -m unittest discover -s tests
# Node tests use a locally installed playwright-core and Google Chrome.
# Set NODE_PATH to the directory containing playwright-core if installed separately.
node --test --test-concurrency=2 tests/*.test.js tests/*.test.mjs
```

CI runs on pull requests to main and pushes to main. A Linux job runs the checksum-pinned Gitleaks CLI over Git history and the checkout with full redaction. The macOS job uses Python 3.12, Node 24, Swift/PDFKit, the runner’s Google Chrome and Playwright Core 1.62.1. It runs both commands above. CI omits the optional SDK installation, so the four official SDK tests (the storage-adapter test and three token-refresh tests) report skips, and CI fails if any other Node test skips. Mock bridge and isolation tests still run.

For a local pre-commit check, explicitly stage reviewed paths, inspect `git diff --cached`, then run `gitleaks git --pre-commit --staged --redact=100` with a verified Gitleaks 8.30.1 CLI. Keep hooks disabled until the developer reviews a local hook and its executable path.

Browser tests use mock services. Generated material and scripted feedback exercise application behavior. They do not establish educational accuracy or learning gains. The optional draft cookie/session activity has human approval gates. It links to public documents for further reading and reproduces no text from them. The sample lessons, calculus lesson, learner messages and feedback in this repository are scripted test material written with an AI coding assistant. They are neither recorded model output nor verified teaching material.

No license has been chosen, so no permission to reuse or redistribute this code is granted. The optional SDK is downloaded separately under its own noncommercial license.
