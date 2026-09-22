# Reference tooling

TypeScript reference implementation of the conversions described in the
[JSON Representation of DASH MPD](../spec/dash-json.md) specification. The
spec is normative; where this code and the spec disagree, the spec wins.

All commands below run from this directory.

## Setup

Requires Node.js 18+ and `xmllint` (for XSD validation).

```bash
npm install
```

## Commands

| Command | What it does |
|---|---|
| `npm run mpd2json -- <in.mpd> [-o out.json]` | MPD XML → JSON, validated against the XSD and the JSON Schema |
| `npm run json2mpd -- <in.json> [-o out.mpd]` | JSON → MPD XML |
| `npm run validate-roundtrip -- <in.mpd ...>` | MPD → JSON → MPD and compare |
| `npm run roundtrip-report` | Round-trip every file in `../test-vectors/` and summarise |
| `npm run convert -- <in.xsd> -o <out.json>` | Generic XSD → JSON Schema 2020-12 |
| `npm run generate-schema` | Regenerate `../schemas/json/dash-mpd.schema.json` from the DASH XSD |
| `npm run generate-patch-schema` | Regenerate `../schemas/json/dash-mpd-patch.schema.json` |
| `npm run patch-cli -- convert-patch <patch.mpp>` | XML MPD Patch → JSON patch |
| `npm run patch-cli -- apply <mpd.json> <patch.json>` | Apply a JSON patch to a JSON MPD |
| `npm run patch-cli -- full <manifest.mpd> <patch.mpp>` | Convert MPD and patch, apply, output the result |

Every command accepts `-h` for the full option list. The converters default to
`../schemas/xsd/DASH-MPD.xsd` and `../schemas/json/dash-mpd.schema.json`;
override with `--xsd` / `--json-schema`. `--skip-xsd` and `--skip-json-schema`
turn validation off for speed.

Example:

```bash
npm run mpd2json -- ../test-vectors/iso-23009-1/example_G1.mpd -o /tmp/g1.json
npm run json2mpd -- /tmp/g1.json -o /tmp/g1.mpd
npm run roundtrip-report -- --skip-xsd --include-dashjs --include-dashif
```

## Layout

```
src/                   converters, validators, CLIs
src/__tests__/         vitest suite (reads ../test-vectors and ../schemas)
benchmarks/            round-trip report script and two Vite parser benchmarks
scripts/               one-off helpers (minifier for pretty-printed fixtures)
```

## Development

```bash
npm test          # vitest in watch mode
npm run test:run  # single run
npm run build     # compile to dist/
```

The tests and benchmarks resolve `../schemas` and `../test-vectors` relative to
this directory, so keep the repository layout intact when running them.
