# DASH XSD to JSON Schema Converter

This project provides tools for working with MPEG-DASH manifests in JSON format:

1. **XSD to JSON Schema Converter** - Converts MPEG-DASH XSD schemas to JSON Schema format
2. **MPD to JSON Converter** - Converts MPD XML manifests to validated JSON
3. **JSON to MPD Converter** - Converts JSON back to MPD XML (round-trip support)

## JSON Schema Version

This project generates schemas compliant with **JSON Schema 2020-12**, the latest stable version of the JSON Schema specification:

- Core: https://json-schema.org/draft/2020-12/json-schema-core
- Validation: https://json-schema.org/draft/2020-12/json-schema-validation
- Relative JSON Pointer: https://datatracker.ietf.org/doc/html/draft-bhutton-relative-json-pointer-00

## Installation

```bash
npm install
```

## Usage

### Convert MPD to JSON

Convert a DASH MPD XML manifest to JSON format with validation:

```bash
npm run mpd2json -- <input.mpd> [options]

# Example: Convert with full validation
npm run mpd2json -- manifest.mpd -o manifest.json

# Example: Skip XSD validation (faster)
npm run mpd2json -- manifest.mpd --skip-xsd -o manifest.json

# Example: Verbose mode
npm run mpd2json -- manifest.mpd -v -o manifest.json
```

#### MPD to JSON CLI Options

```
mpd2json <input.mpd> [options]

Options:
  -o, --output <file>       Output JSON file (default: stdout)
  --xsd <path>              Path to XSD schema (default: xml-schemas/DASH-MPD.xsd)
  --json-schema <path>      Path to JSON Schema (default: output/dash-mpd.schema.json)
  --skip-xsd                Skip XSD validation
  --skip-json-schema        Skip JSON Schema validation
  --no-pretty               Output minified JSON
  -v, --verbose             Show detailed validation messages
  -h, --help                Show help
```

The converter performs the following steps:
1. **XSD Validation** - Validates the input MPD against the DASH-MPD XSD schema (using `xmllint`)
2. **XML to JSON Conversion** - Converts XML to JSON matching our schema structure
3. **JSON Schema Validation** - Validates the output JSON against the generated JSON Schema

### Convert XSD to JSON Schema

Convert an XSD file to JSON Schema:

```bash
npm run convert <input.xsd> -o <output.json>

# Example
npm run convert xml-schemas/DASH-MPD.xsd -o output/dash-mpd.schema.json
```

#### XSD to JSON Schema CLI Options

```
xsd2jsonschema <input.xsd> [options]

Options:
  -o, --output <file>      Output file (default: stdout)
  --base-uri <uri>         Base URI for $id in the schema
  --attr-prefix <prefix>   Prefix for XML attributes (e.g., '@')
  --no-pretty              Output minified JSON
  -h, --help               Show help
```

## XSD to JSON Schema Mapping

| XSD Construct | JSON Schema Equivalent |
|---------------|------------------------|
| `xs:string` | `"type": "string"` |
| `xs:integer` | `"type": "integer"` |
| `xs:boolean` | `"type": "boolean"` |
| `xs:double` | `"type": "number"` |
| `xs:dateTime` | `"type": "string", "format": "date-time"` |
| `xs:duration` | `"type": "string"` with ISO 8601 pattern |
| `xs:anyURI` | `"type": "string", "format": "uri-reference"` |
| `xs:enumeration` | `"enum": [...]` |
| `xs:pattern` | `"pattern": "..."` |
| `xs:minInclusive/maxInclusive` | `"minimum"/"maximum"` |
| `xs:complexType` | `"type": "object"` with `"properties"` |
| `xs:sequence` | `"properties"` + `"required"` |
| `xs:choice` | `"oneOf"` |
| `xs:extension` | `"allOf"` with `"$ref"` |
| `xs:list` | `"type": "array"` |

## Source Schemas

The `xml-schemas/` directory contains the MPEG-DASH XSD schemas:

- **DASH-MPD.xsd** - Main Media Presentation Description schema
- **CENC.xsd** - Common Encryption schema
- **xlink.xsd** - XLink attributes
- **DASH-MPD-UP.xsd** - URL parameters extension
- **DASH-MPD-PATCH.xsd** - MPD patch operations

## Output

Generated JSON Schemas are written to the `output/` directory:

- `dash-mpd.schema.json` - Complete DASH MPD schema (~70KB, 98 type definitions)
- `cenc.schema.json` - CENC types
- `xlink.schema.json` - XLink types
- `dash-mpd-up.schema.json` - URL parameter types

## XML to JSON Mapping

When converting MPD XML to JSON, the following conventions are used:

| XML Construct | JSON Representation |
|--------------|---------------------|
| Element with text content only (no attributes in schema) | `"Element": "text value"` |
| Element with text + possible attributes (defined in schema) | `"Element": { "$value": "text", "attr": "value" }` |
| Repeated elements | `"Element": [...]` (array) |
| Attributes | Direct properties on the object |
| Namespace declarations | Root-level `$ns` object mapping URIs to prefixes |
| Namespaced attributes (e.g., `xlink:href`) | Grouped under prefix key (e.g., `"xlink": { "href": "..." }`) |
| Extension elements | Grouped under prefix key (e.g., `"ext": { "CustomElement": ... }`) |

**Note:** Elements use `$value` for text content when the XSD schema defines possible attributes for that element type, even if no attributes are present in a particular instance. This ensures consistent JSON structure.

### Example

**XML:**
```xml
<BaseURL availabilityTimeOffset="5.0">https://example.com/video/</BaseURL>
```

**JSON:**
```json
{
  "BaseURL": [{
    "$value": "https://example.com/video/",
    "availabilityTimeOffset": 5.0
  }]
}
```

### Namespace Example

**XML:**
```xml
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011"
     xmlns:xlink="http://www.w3.org/1999/xlink">
  <Period id="p0" xlink:href="http://example.com/period.xml" xlink:actuate="onLoad"/>
</MPD>
```

**JSON:**
```json
{
  "$ns": {
    "http://www.w3.org/1999/xlink": {
      "prefix": "xlink",
      "attributes": ["href", "actuate"]
    }
  },
  "Period": [{
    "id": "p0",
    "xlink": {
      "href": "http://example.com/period.xml",
      "actuate": "onLoad"
    }
  }]
}
```

Namespace declarations are collected at the root `$ns` object only. Each prefix maps to exactly one URI and vice versa. See the [specification](#specification), section "Namespace Handling", for the full rules.

## Specification

The normative description of the JSON representation is a
[Bikeshed](https://speced.github.io/bikeshed/) document, following the DASH-IF
authoring workflow (see the
[DASH-IF-IOP authoring guide](https://dashif.org/DASH-IF-IOP/authoring/)):

- `docs/dash-json.md` - the text
- `docs/dash-json.bs` - the Bikeshed metadata; includes `dash-json.md`
- `docs/Images/` - static images referenced from the text

The published version is at
<https://dash-industry-forum.github.io/dash-json-schema/> (built from `main` by
the `publish-bikeshed` workflow; pull requests build a `dist` artifact for
review).

To build locally you need Docker; the DASH-IF builder image contains Bikeshed and
the DASH-IF boilerplate. Output goes to `docs/dist/`:

```bash
./build.sh              # HTML + PDF
./build.sh spec.html    # HTML only
./build.sh spec-watch   # rebuild on change, Ctrl-C to stop
./build.sh spec-serve   # rebuild on change and serve on http://localhost:8000
./build.sh help         # all targets
```

On Windows use `build.bat` with the same arguments.

## Prerequisites

- **Node.js** 18+ 
- **xmllint** (for XSD validation) - typically pre-installed on macOS/Linux

## Development

```bash
# Build TypeScript
npm run build

# Run tests
npm test
```

## License

MIT
