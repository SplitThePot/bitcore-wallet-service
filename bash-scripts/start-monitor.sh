#!/bin/bash

ECOSYSTEM=ecosystem.json

if [[ $# -gt 0 ]]; then
  if [[ "$1" == "--debug" ]]; then
    echo "Debug mode"
    ECOSYSTEM=ecosystem.debug.json
  fi
fi

pm2-runtime start "$ECOSYSTEM" --only bcmonitor 