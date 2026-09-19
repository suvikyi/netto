#!/usr/bin/env bash

set -euo pipefail

readonly NETTO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly NETTO_BIN="${NETTO_ROOT}/obj-x86_64-pc-linux-gnu/dist/bin/firefox"
readonly PROFILE_DIR="${HOME}/.config/netto"

if [[ ! -O "${NETTO_ROOT}" || ! -f "${NETTO_ROOT}/mach" ]]; then
  printf 'Netto launcher must be run from a complete development checkout: %s\n' "${NETTO_ROOT}" >&2
  exit 1
fi
if [[ ! -x "${NETTO_BIN}" ]]; then
  printf 'Netto development binary is missing: %s\n' "${NETTO_BIN}" >&2
  exit 1
fi

exec "${NETTO_BIN}" --profile "${PROFILE_DIR}" "$@"
