#!/bin/sh
set -eu

case "${1:-}" in
  setup)
    if [ -f package.json ]; then
      if [ ! -f package-lock.json ]; then
        echo 'package.json requires a committed package-lock.json' >&2
        exit 1
      fi
      npm ci
    else
      echo 'No package manifest yet; checkout is ready.'
    fi
    ;;
  check)
    if [ -f package.json ]; then
      npm run check --if-present
      npm test --if-present
      npm run build --if-present
    else
      echo 'No package checks yet; checkout is ready.'
    fi
    ;;
  *)
    echo "usage: $0 setup|check" >&2
    exit 2
    ;;
esac
