#!/usr/bin/env bash
# Builds the Agent Viz Android app (screensaver + live wallpaper) into a
# signed APK and publishes it to ../public/agent-viz.apk for phone download.
# Gradle-free on purpose: zero dependencies means Gradle solves nothing here.
# Run from this directory: bash build.sh
set -euo pipefail
cd "$(dirname "$0")"

JAVA_HOME=$(ls -d "/c/Program Files/Microsoft/jdk-17"* | head -1)
export JAVA_HOME
SDK=/c/Android
BT="$SDK/build-tools/36.1.0"
AJAR="$SDK/platforms/android-36/android.jar"

# one-time keystore — NEVER regenerate: a new key means the phone refuses the
# update and the user must uninstall/reinstall (losing wallpaper placement)
if [ ! -f keystore/agent-viz.jks ]; then
  # head reads first (finite), so no SIGPIPE under pipefail
  head -c 18 /dev/urandom | base64 | tr -d '/+=\n' | cut -c1-24 > keystore/kspass.txt
  "$JAVA_HOME/bin/keytool" -genkeypair -keystore keystore/agent-viz.jks \
    -alias agentviz -keyalg RSA -keysize 2048 -validity 10950 \
    -storepass "$(cat keystore/kspass.txt)" -dname "CN=Agent Viz,O=agent-viz"
  echo "generated new keystore (keep keystore/ safe!)"
fi

VC=$(( $(cat version.txt) + 1 )); echo "$VC" > version.txt
echo "== building versionCode $VC =="

rm -rf build/classes build/dex build/res.zip build/app.unaligned.apk build/app.aligned.apk build/agent-viz.apk
mkdir -p build/classes build/dex

"$BT/aapt2.exe" compile --dir app/res -o build/res.zip
"$BT/aapt2.exe" link -o build/app.unaligned.apk -I "$AJAR" \
  --manifest app/AndroidManifest.xml \
  --min-sdk-version 26 --target-sdk-version 36 \
  --version-code "$VC" --version-name "1.$VC" \
  build/res.zip

"$JAVA_HOME/bin/javac" -source 1.8 -target 1.8 -encoding UTF-8 -nowarn \
  -bootclasspath "$AJAR" -d build/classes $(find app/src -name '*.java')

"$BT/d8.bat" --release --lib "$AJAR" --min-api 26 --output build/dex \
  $(find build/classes -name '*.class')

# classes.dex must sit at the APK root; aapt stores the path relative to cwd
(cd build/dex && "$BT/aapt.exe" add ../app.unaligned.apk classes.dex) \
  || (cd build/dex && "$JAVA_HOME/bin/jar" uf ../app.unaligned.apk classes.dex)

# align BEFORE signing — v2+ signatures break if you align afterwards
"$BT/zipalign.exe" -f -p 4 build/app.unaligned.apk build/app.aligned.apk

"$BT/apksigner.bat" sign --ks keystore/agent-viz.jks --ks-key-alias agentviz \
  --ks-pass file:keystore/kspass.txt --out build/agent-viz.apk build/app.aligned.apk

"$BT/apksigner.bat" verify --print-certs build/agent-viz.apk
"$BT/aapt2.exe" dump badging build/agent-viz.apk | head -4

cp build/agent-viz.apk ../public/agent-viz.apk
echo "== published to public/agent-viz.apk =="
