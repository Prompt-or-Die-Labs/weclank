#!/usr/bin/env bash
# Smoke test for the OmniVoice local voice model.
#
#   1. Build the llama-omnivoice-server binary if it isn't there.
#   2. Run the always-on carrot integration test (status + lifecycle).
#   3. Run the E2E synthesize test with WECLANK_OMNIVOICE_E2E=1 so
#      ~660MB of GGUF models are downloaded on first run and "Hi" is
#      synthesized to a real WAV.
#   4. Exit 0 only if a valid RIFF WAV came back.
#
# Intended for a real local environment (macOS / Linux with cmake + git +
# bun). Skip / abort in CI unless an environment grants the time + disk.
#
# Usage:
#   scripts/smoke-omnivoice.sh                # full path
#   scripts/smoke-omnivoice.sh --skip-build   # assume binary already built

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

SKIP_BUILD=0
for arg in "$@"; do
	case "$arg" in
		--skip-build) SKIP_BUILD=1 ;;
		--help|-h)
			grep -E "^# " "$0" | sed 's/^# \?//'
			exit 0
			;;
	esac
done

LOCAL_INFERENCE_DIR="${WECLANK_LOCAL_INFERENCE_DIR:-$HOME/.weclank/local-inference}"
BIN_PATH="$LOCAL_INFERENCE_DIR/bin/llama-omnivoice-server"

echo "[smoke-omnivoice] root: $LOCAL_INFERENCE_DIR"

# Phase 1 — ensure the binary is built.
if [[ ! -x "$BIN_PATH" && $SKIP_BUILD -eq 0 ]]; then
	echo "[smoke-omnivoice] binary missing — running bun run build:omnivoice (this can take 5-15 min on first run)"
	bun run build:omnivoice
fi

if [[ ! -x "$BIN_PATH" ]]; then
	echo "[smoke-omnivoice] ERROR: $BIN_PATH does not exist or is not executable after build" >&2
	exit 1
fi
echo "[smoke-omnivoice] binary present: $BIN_PATH"

# Phase 2 — lifecycle test (always-on, no downloads).
echo "[smoke-omnivoice] running lifecycle test"
bun test src/bun/carrots/omnivoice.integration.test.ts

# Phase 3 — E2E synthesize. Downloads ~660MB the first time.
echo "[smoke-omnivoice] running E2E synthesize (WECLANK_OMNIVOICE_E2E=1)"
WECLANK_OMNIVOICE_E2E=1 bun test src/bun/carrots/omnivoice.integration.test.ts

echo "[smoke-omnivoice] PASS — local voice model produced a real RIFF WAV"
