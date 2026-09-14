#!/usr/bin/env bash
# Sourced after shared/server.env. Development config remains explicitly local.
napplet_index_env() {
  local domain=$1
  local defaults=$2
  local managed_read='ws://127.0.0.1:19347/relay'
  local managed_hint="wss://${3:-relay.$domain}"
  local public_relays
  public_relays=$(node -p 'require(process.argv[1]).join(",")' "$defaults") || return
  export SPACE_INDEX_RELAYS="${SPACE_INDEX_RELAYS:-ws://127.0.0.1:19347/relay,$public_relays}"
  # Never put the VPS's internal address into portable Nostr links. An explicit
  # operator hint list is preserved; otherwise retain all configured destinations.
  export SPACE_INDEX_HINTS="${SPACE_INDEX_HINTS:-${SPACE_INDEX_RELAYS//$managed_read/$managed_hint}}"
}
