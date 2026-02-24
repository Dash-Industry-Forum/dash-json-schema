# MPD parser benchmark

This is a Vite vanilla JS page for parser-focused MPD benchmarks.

It compares:

- `DOMParser` XML parse + DOM tree conversion to plain object
- `JSON.parse` for a JSON string generated from the loaded MPD
- `@svta/cml-xml` (`parseXml`) XML parse to object structure

The MPD -> JSON conversion used for the compare pane now calls the repo's real converter tool (`src/mpd-converter-cli.ts`) through a small Vite API endpoint (`POST /api/convert-mpd`) instead of using a local ad-hoc XML parser mapping.

It also includes:

- quick example selection from the repo `examples` folder (symlinked)
- MPD loading from a URL (subject to CORS)
- configurable measured and warmup iteration counts (for example, `1000` + `100`)
- visual progress bar that advances per iteration across all benchmark methods
- side-by-side XML and JSON visual compare with independent scrolling and token navigation
- click-based linking between XML elements/attributes and converted JSON keys

## Run

```bash
npm install
npm run dev
```

Note: this benchmark expects the repository root dependencies to be installed too (the endpoint shells out to `npx ts-node src/mpd-converter-cli.ts`).

Then open the Vite URL and use the controls in the page.
