#!/usr/bin/env bash
# Собирает плагин и складывает в install/ ровно то, что копируется на терминал.
# Служебные библиотеки, которые iikoFront приносит сам, в папку не кладём:
# свои копии рядом с плагином приводят к конфликту версий.
set -euo pipefail

here="$(cd "$(dirname "$0")/.." && pwd)"
out="$here/install"
build="$here/src/Reservly.IikoFrontBridge/bin/Release/net472"

dotnet build "$here/src/Reservly.IikoFrontBridge" -c Release --nologo

rm -rf "$out"
mkdir -p "$out"

cp "$build/Reservly.IikoFrontBridge.dll" "$out/"
cp "$here/src/Reservly.IikoFrontBridge/Manifest.xml" "$out/"
cp "$here/bridge.settings.json" "$out/"

for lib in System.Reactive System.Drawing.Common System.Threading.Tasks.Extensions System.ValueTuple; do
  cp "$build/$lib.dll" "$out/"
done

# Скрипт установки и памятка едут вместе с плагином: тот, кто ставит его
# в ресторане, не должен искать инструкцию в репозитории
cp "$here/tools/install-from-artifact.ps1" "$out/"
[ -f "$here/install-readme.md" ] && cp "$here/install-readme.md" "$out/КАК-СТАВИТЬ.md"

echo "Готово: $out"
ls -la "$out" | tail -n +2
