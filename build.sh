#!/usr/bin/env bash

# Build the Bikeshed specification with the DASH-IF specs builder container.
# Output is written to docs/dist/ (index.html and dash-json.pdf).
#
#   ./build.sh              build HTML and PDF
#   ./build.sh spec.html    build only the HTML
#   ./build.sh spec-watch   rebuild on change (Ctrl-C to stop)
#   ./build.sh spec-serve   rebuild on change and serve on http://localhost:8000
#   ./build.sh help         list all targets

IMG=dashif/specs-builder:latest

# Allow to overwrite additional options from the outside.
# We use tty and interactive by default since this makes it easier
# to deal with watch mode and Ctrl-C etc but we can not use this
# for instance in CI mode
if [ -z ${OPTS+x} ]; then
  OPTS=-ti
fi

TARGETS="${@}"
if [ -z "${TARGETS}" ]; then
  TARGETS="spec"
fi
TARGETS="-C docs ${TARGETS} SRC=dash-json.bs NAME=dash-json"

docker run --rm ${OPTS} -v `pwd`:/data -p 8000:8000 ${IMG} ${TARGETS}
