# JSON Representation of DASH MPD

A DASH-IF specification defining a JSON representation of the MPEG-DASH Media
Presentation Description (MPD), including JSON Schema derived from the DASH
XSD, MPD Patch, and XLink remote element loading.

Published draft: <https://dash-industry-forum.github.io/dash-json-schema/>

## Repository layout

| Path | Contents |
|---|---|
| `spec/` | The specification: `dash-json.md` (text) and `dash-json.bs` (Bikeshed metadata), plus `Images/` |
| `schemas/xsd/` | The MPEG-DASH XSD schemas the JSON Schema is derived from |
| `schemas/json/` | The generated JSON Schemas: `dash-mpd.schema.json`, `dash-mpd-patch.schema.json` |
| `test-vectors/` | MPDs used to exercise the conversion: `iso-23009-1/` (ISO annex examples), `dash-if/`, `dash-js/`, `misc/` |
| `tools/` | TypeScript reference implementation of the converters, tests and benchmarks — see [`tools/README.md`](tools/README.md) |

## Building the spec

The spec follows the [DASH-IF authoring workflow](https://dashif.org/DASH-IF-IOP/authoring/)
and builds with Docker via the DASH-IF `specs-builder` image. Output goes to
`spec/dist/`.

```bash
./build.sh              # HTML + PDF
./build.sh spec.html    # HTML only
./build.sh spec-serve   # rebuild on change and serve on http://localhost:8000
./build.sh help         # all targets
```

On Windows use `build.bat` with the same arguments.

Pull requests that touch `spec/` build a `dist` artifact for review; pushes to
`main` publish to GitHub Pages.

## Contributing

Edit `spec/dash-json.md` and open a pull request. Discussion happens in the
[issue tracker](https://github.com/Dash-Industry-Forum/dash-json-schema/issues).

## License

MIT
