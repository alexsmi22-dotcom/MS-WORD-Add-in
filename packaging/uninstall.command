#!/bin/bash
# Formula Inserter — per-user uninstaller for Word on macOS. Removes the
# sideloaded manifest. No admin required. Restart Word afterwards.
#
# Run it: double-click uninstall.command in Finder, or in Terminal:
#   bash uninstall.command

set -uo pipefail

WEF="$HOME/Library/Containers/com.microsoft.Word/Data/Documents/wef"
rm -f "$WEF/formula-inserter.manifest.xml"

# Word caches sideloaded add-in state here; clearing it forces a clean reload.
CACHE="$HOME/Library/Containers/com.microsoft.Word/Data/Library/Caches/com.microsoft.Office365ServiceV2"
rm -rf "$CACHE" 2>/dev/null || true

echo "Formula Inserter removed. Restart Word to complete removal."
echo ""
read -n 1 -s -r -p "Press any key to close this window."
echo ""
