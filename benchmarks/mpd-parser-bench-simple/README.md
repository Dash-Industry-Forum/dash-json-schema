# MPD Parser Benchmark (Simple)

A stripped-down parser benchmark designed to run on Tizen and webOS smart TV
platforms. It benchmarks three parsing approaches against the large
`livesim_very_large.mpd` manifest (~6 MB XML, ~5 MB JSON):

| Method | Input |
|---|---|
| `DOMParser` -> plain object | XML |
| `JSON.parse` | pre-converted JSON |
| `@svta/cml-xml parseXml` | XML |

The JSON version of the MPD is pre-generated and bundled as a static asset so
the benchmark has **zero server-side dependencies** -- it runs entirely in the
browser from static files.

## Quick start (desktop)

```bash
npm install
npm run dev
```

## Build

```bash
npm run build          # standard build (absolute paths)
npm run build:tizen    # relative-path build for Tizen
npm run build:webos    # relative-path build for webOS
```

## Deploy to Tizen

### Prerequisites

- [Tizen Studio](https://developer.tizen.org/development/tizen-studio) with
  the TV extensions installed
- `tizen` CLI in your PATH

### Package and install

```bash
npm run package:tizen
# Creates tizen-package/ with config.xml + built app

tizen package -t wgt -- tizen-package/
tizen install -n MpdBench00.MpdParserBenchmark.wgt -t <device-name>
```

Or copy the `tizen-package/` directory contents into an existing Tizen Studio
project and build from the IDE.

## Deploy to webOS

### Prerequisites

- [webOS TV SDK](https://webostv.developer.lge.com/develop/tools/cli-installation)
  with `ares-*` CLI tools in your PATH

### Package and install

```bash
npm run package:webos
# Creates webos-package/ with appinfo.json + built app

ares-package webos-package/
ares-install com.example.mpdbenchmark_1.0.0_all.ipk
```

## Updating the test data

The pre-generated JSON file lives in `public/data/`. To regenerate it from the
repository root:

```bash
node dist/mpd-converter-cli.js \
  examples/livesim_very_large.mpd \
  --skip-xsd --skip-json-schema --no-pretty \
  --output benchmarks/mpd-parser-bench-simple/public/data/livesim_very_large.mpd.json
```

The MPD file itself is also a static copy in `public/data/`. Update it by
copying from `examples/livesim_very_large.mpd`.
