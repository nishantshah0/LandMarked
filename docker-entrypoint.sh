#!/bin/sh
# First boot on a fresh volume installs the landmark database baked into the
# image, rather than calling out to Overpass.
#
# The old CMD was `npm run seed && npm start`, which meant a deploy could fail
# outright if Overpass was slow or rate-limiting — a 10k-element query for the
# whole GTA, running while the platform's health check counts down. Landmarks
# barely change; there is no reason to fetch them at boot.
#
# The volume always wins once it has data, so redeploys never overwrite a live
# archive. To publish a wider or re-pulled landmark set: reseed locally
# (`npm run seed -- --force`), rebuild the image, and delete the volume's
# seen.db — or just run `npm run seed -- --force` on the box.

set -e

mkdir -p /app/data/photos /app/data/splats

if [ ! -f /app/data/seen.db ]; then
  if [ -f /app/seed/landmarks.db ]; then
    echo "[boot] fresh volume — installing the baked landmark database"
    cp /app/seed/landmarks.db /app/data/seen.db
  else
    echo "[boot] no baked database found; pulling landmarks from OpenStreetMap"
    npm run seed || echo "[boot] seed failed — starting anyway, run 'npm run seed' later"
  fi
fi

exec npm start
