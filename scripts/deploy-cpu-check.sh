#!/usr/bin/env bash

# Shared by the read-only inventory and both deployment entry points. Arguments
# let tests exercise recorded /proc/cpuinfo without executing a foreign runtime.
napplet_check_cpu() {
  local kernel=${1:-$(uname -s)}
  local architecture=${2:-$(uname -m)}
  local cpuinfo=${3:-/proc/cpuinfo}
  local profile=${4:-standard}
  if [[ "$profile" != standard && "$profile" != legacy-x64 ]]; then
    echo 'Unknown deployment runtime profile.' >&2
    return 1
  fi
  if [[ "$kernel" != Linux ]]; then
    echo 'Deployment requires a Linux VPS.' >&2
    return 1
  fi
  if [[ "$profile" == legacy-x64 ]]; then
    if [[ "$architecture" != x86_64 ]]; then
      echo 'The legacy CPU profile is only available for Linux x86_64.' >&2
      return 1
    fi
    echo 'Legacy CPU profile: Bun 1.3.8 and source-built image libraries; runtime checks are required.'
    return 0
  fi
  case "$architecture" in
    x86_64)
      # Check every advertised CPU, require a complete flag token, and fail
      # closed if the kernel does not expose any usable capability information.
      if [[ ! -r "$cpuinfo" ]] || ! awk '
        /^[[:space:]]*flags[[:space:]]*:/ {
          seen++; found=0
          for (i=1; i<=NF; i++) if ($i == "sse4_2") found=1
          if (!found) missing=1
        }
        END { exit !(seen && !missing) }
      ' "$cpuinfo"; then
        echo 'Unsupported virtual CPU: Bun requires SSE4.2 on x86_64, including its baseline build. Ask the VPS provider to expose SSE4.2 (for example, host CPU passthrough). No deployment changes made.' >&2
        return 1
      fi
      echo 'CPU requirement passed: Linux x86_64 with SSE4.2.'
      ;;
    aarch64|arm64) echo 'CPU architecture supported: Linux arm64.' ;;
    *) echo 'Supported VPS architectures: x86_64 with SSE4.2 and arm64.' >&2; return 1 ;;
  esac
}
