#!/bin/bash
# Formula Inserter — per-user installer for Word on macOS (no admin required).
#
# Word on the Mac has no registry. Instead it loads sideloaded add-ins from a
# per-user "wef" folder inside its app container. This script copies the
# manifest there. After running, restart Word and find it under:
#   Insert > Add-ins > (your add-ins) > Formula Inserter
#
# Run it: double-click install.command in Finder. If macOS blocks it with
# "unidentified developer", right-click it > Open > Open, or run in Terminal:
#   bash install.command

set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
SRC="$DIR/manifest.xml"
if [ ! -f "$SRC" ]; then
  echo "Error: manifest.xml not found next to this script." >&2
  exit 1
fi

# Word's per-user sideload folder (created on first launch of modern Word).
WEF="$HOME/Library/Containers/com.microsoft.Word/Data/Documents/wef"
mkdir -p "$WEF"

cp "$SRC" "$WEF/formula-inserter.manifest.xml"

echo ""
echo "Formula Inserter installed for your user account."
echo ""
echo "Next steps:"
echo "  1. Fully quit Word (Cmd-Q), then reopen it."
echo "  2. Insert tab > Add-ins (My Add-ins) > Formula Inserter."
echo ""
echo "To remove it later, run uninstall.command."

# Keep the window open when double-clicked from Finder.
echo ""
read -n 1 -s -r -p "Press any key to close this window."
echo ""
