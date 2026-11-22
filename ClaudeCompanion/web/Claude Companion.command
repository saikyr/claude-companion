#!/bin/sh
# macOS: double-click to start the Claude Companion app (a small local server) and open it.
# First time only: right-click this file > Open (macOS asks once because it came from another computer).
cd "$(dirname "$0")" || exit 1
if ! /usr/bin/python3 -c 'import sys; sys.exit(sys.version_info < (3, 7))' 2>/dev/null; then
  echo "Claude Companion needs Python 3, which comes with Apple's free Command Line Tools."
  echo "A window to install them should appear now. When it finishes, double-click this file again."
  xcode-select --install 2>/dev/null
  read -r _ ; exit 1
fi
exec /usr/bin/python3 server.py
