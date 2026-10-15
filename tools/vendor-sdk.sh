#!/bin/sh
# Builds app/vendor/: the ElevenLabs voice SDK as one self-hosted file, plus the
# audio resampler it would otherwise fetch from jsDelivr. Self-hosted so a live
# session doesn't send the student's IP address to a CDN (GDPR).
#
#   sh tools/vendor-sdk.sh          # then bump VERSION in app/sw.js
#
# To upgrade: change the versions below, run, test a live session.
set -e
CLIENT=1.27.0
RESAMPLER=2.1.2

ROOT=$(cd "$(dirname "$0")/.." && pwd)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
cd "$TMP"
npm init -y >/dev/null
npm install --silent "@elevenlabs/client@$CLIENT" "@alexanderolsen/libsamplerate-js@$RESAMPLER" esbuild@0.24.0
echo 'export { Conversation } from "@elevenlabs/client";' > entry.js
mkdir -p "$ROOT/app/vendor"
npx esbuild entry.js --bundle --format=esm --minify --legal-comments=eof \
  --outfile="$ROOT/app/vendor/elevenlabs-client.js"
cp node_modules/@alexanderolsen/libsamplerate-js/dist/libsamplerate.worklet.js "$ROOT/app/vendor/"
{
  echo "@elevenlabs/client $CLIENT (MIT), bundled with livekit-client (Apache-2.0)"
  echo "@alexanderolsen/libsamplerate-js $RESAMPLER (MIT)"
  echo "Built by tools/vendor-sdk.sh – licence texts are at the end of each file / on npm."
} > "$ROOT/app/vendor/VERSIONS.txt"
ls -la "$ROOT/app/vendor"
