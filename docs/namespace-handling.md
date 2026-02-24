# XML Namespace Handling in DASH MPD JSON

This document describes how XML namespaces are handled when converting DASH MPD documents between XML and JSON formats.

## Overview

DASH MPD documents can contain extension elements and attributes from namespaces other than the core DASH namespace (`urn:mpeg:dash:schema:mpd:2011`). These extensions are defined using `xs:any` (for elements) and `xs:anyAttribute` (for attributes) in the XSD schema.

The JSON representation preserves namespace information to enable:
1. **Reliable pass-through** of third-party extensions
2. **Round-trip fidelity** (XML to JSON to XML conversion)
3. **Clear structure** for implementers

To keep the JSON format simple, efficient, and unambiguous, this specification imposes constraints on how namespaces may be used. These constraints cover the vast majority of real-world DASH content (see [Namespace Constraints](#namespace-constraints)).

## The `$ns` Property

Namespace declarations are represented using the special `$ns` property, which maps namespace URIs to their prefixes. The `$ns` property appears **only at the root level** of the JSON document.

### Structure

Each entry in `$ns` maps a namespace URI to either:
- A **string** (the prefix) -- for namespaces that only define extension elements, or
- An **object** with `prefix` and optional `attributes` -- for namespaces that also define extension attributes

```json
{
  "$ns": {
    "<namespace-uri>": "<prefix>",
    "<namespace-uri>": { "prefix": "<prefix>", "attributes": ["<attr1>", "<attr2>"] },
    ...
  }
}
```

The `attributes` array lists the local names of extension **attributes** used anywhere in the document for that namespace. This lets a JSON-to-XML converter distinguish extension attributes (`prefix:name="value"`) from text-only extension elements (`<prefix:name>value</prefix:name>`), since both are plain strings in JSON.

### Examples

Simple form (most common):

```json
{
  "$ns": {
    "urn:example:dash:extension:2026": "ext",
    "http://www.w3.org/1999/xlink": "xlink"
  },
  "profiles": "urn:mpeg:dash:profile:isoff-on-demand:2011",
  "minBufferTime": "PT2S",
  "Period": [...]
}
```

Extended form (when a namespace defines extension attributes):

```json
{
  "$ns": {
    "urn:mpeg:cenc:2013": {
      "prefix": "cenc",
      "attributes": ["default_KID"]
    }
  },
  "Period": [...]
}
```

In this example, `cenc:default_KID` appears as an XML attribute, while `cenc:pssh` (not listed in `attributes`) is an XML child element. Both are strings in JSON, but the `attributes` metadata resolves the ambiguity.

### Root-Only Placement

The `$ns` property is only permitted at the root of the JSON document. Nested `$ns` declarations within child objects are not supported.

When converting XML to JSON, all namespace declarations from any depth in the XML tree are hoisted to the root `$ns`. If this hoisting would create a conflict (e.g., the same prefix bound to different URIs at different depths), the converter rejects the document with an error.

This design keeps the namespace registry flat and document-wide, so consumers never need to walk up the object tree to resolve a prefix.

## Extension Content

Extension elements and attributes are grouped under their namespace prefix key.

### Extension Elements

XML extension elements are placed under a key matching their prefix:

**XML:**
```xml
<SupplementalProperty xmlns:ext="urn:example:extension" schemeIdUri="..." value="...">
  <ext:MetadataBlock version="1.0">
    <ext:ContentId>movie-123</ext:ContentId>
    <ext:Policy>
      <ext:MaxResolution>1920x1080</ext:MaxResolution>
    </ext:Policy>
  </ext:MetadataBlock>
</SupplementalProperty>
```

**JSON:**
```json
{
  "$ns": {
    "urn:example:extension": "ext"
  },
  "SupplementalProperty": [{
    "schemeIdUri": "...",
    "value": "...",
    "ext": {
      "MetadataBlock": {
        "version": "1.0",
        "ContentId": "movie-123",
        "Policy": {
          "MaxResolution": "1920x1080"
        }
      }
    }
  }]
}
```

### Key Rules

1. **Extension content grouped under prefix** -- all elements/attributes from a namespace are under one key
2. **Children inherit namespace** -- nested elements don't repeat the prefix in JSON
3. **Natural JSON structure** -- within the extension block, structure mirrors the XML hierarchy
4. **Attributes vs elements** -- determined by the `attributes` list in `$ns` (see below)

### Distinguishing Extension Attributes from Elements

In JSON, both extension attributes and text-only extension elements are represented as plain strings. The `attributes` list in `$ns` resolves this ambiguity:

- **Listed in `attributes`** -> emitted as an XML attribute: `prefix:name="value"`
- **Not listed** (and primitive) -> emitted as an XML child element: `<prefix:name>value</prefix:name>`
- **Object or array values** -> always emitted as XML child elements, regardless of `attributes`
- **Well-known attribute namespaces** (xlink, xsi) -> all primitives are attributes by default

If a namespace defines no extension attributes (only elements), the simple string form suffices and no `attributes` list is needed.

### DRM Extension Example (CENC)

A common real-world case is the Common Encryption (CENC) namespace, which defines both `cenc:default_KID` (an attribute on `ContentProtection`) and `cenc:pssh` (a child element):

**XML:**
```xml
<ContentProtection
  xmlns:cenc="urn:mpeg:cenc:2013"
  schemeIdUri="urn:mpeg:dash:mp4protection:2011"
  value="cenc"
  cenc:default_KID="9eb4050d-e44b-4802-932e-27d75083e266"/>

<ContentProtection schemeIdUri="urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed">
  <cenc:pssh>AAAANHBzc2g...YQ==</cenc:pssh>
</ContentProtection>
```

**JSON:**
```json
{
  "$ns": {
    "urn:mpeg:cenc:2013": {
      "prefix": "cenc",
      "attributes": ["default_KID"]
    }
  },
  "Period": [{
    "AdaptationSet": [{
      "ContentProtection": [
        {
          "schemeIdUri": "urn:mpeg:dash:mp4protection:2011",
          "value": "cenc",
          "cenc": {
            "default_KID": "9eb4050d-e44b-4802-932e-27d75083e266"
          }
        },
        {
          "schemeIdUri": "urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed",
          "cenc": {
            "pssh": "AAAANHBzc2g...YQ=="
          }
        }
      ]
    }]
  }]
}
```

Both `default_KID` and `pssh` are strings in JSON, but `default_KID` is listed in `attributes`, so it becomes an XML attribute. `pssh` is not listed, so it becomes a child element.

### Default Namespace Redeclaration (`defaultNs`)

Some extension elements use a default namespace redeclaration instead of a prefix:

**XML:**
```xml
<ContentProtection schemeIdUri="urn:uuid:9a04f079-9840-4286-ab92-e65be0885f95">
  <pro xmlns="urn:microsoft:playready">base64data...</pro>
</ContentProtection>
```

In JSON, the element's local name is used as a synthetic prefix with a `defaultNs: true` flag:

**JSON:**
```json
{
  "$ns": {
    "urn:microsoft:playready": { "prefix": "pro", "defaultNs": true }
  },
  "ContentProtection": [{
    "schemeIdUri": "urn:uuid:9a04f079-9840-4286-ab92-e65be0885f95",
    "pro": {
      "$value": "base64data..."
    }
  }]
}
```

The `defaultNs: true` flag tells the JSON-to-XML converter to emit `<pro xmlns="urn:microsoft:playready">` rather than `xmlns:pro="..."` + `<pro:pro>`.

This mechanism has additional constraints -- see [Namespace Constraints](#namespace-constraints).

### Extension Attributes

Extension attributes on DASH elements also go under the prefix key. The attribute names must be listed in the `attributes` array of the corresponding `$ns` entry to ensure correct round-trip conversion:

**XML:**
```xml
<Period id="p0" ext:customAttr="value" ext:anotherAttr="123">
```

**JSON:**
```json
{
  "$ns": {
    "urn:example:extension": {
      "prefix": "ext",
      "attributes": ["customAttr", "anotherAttr"]
    }
  },
  "Period": [{
    "id": "p0",
    "ext": {
      "customAttr": "value",
      "anotherAttr": "123"
    }
  }]
}
```

### Multiple Namespaces

When multiple extension namespaces are used, each gets its own prefix key:

```json
{
  "$ns": {
    "urn:example:ext1": "ext1",
    "urn:example:ext2": "ext2"
  },
  "Period": [{
    "id": "p0",
    "SupplementalProperty": [{
      "schemeIdUri": "...",
      "ext1": {
        "DataA": "value-a"
      },
      "ext2": {
        "DataB": "value-b"
      }
    }]
  }]
}
```

## XLink Namespace

The XLink namespace (`http://www.w3.org/1999/xlink`) is commonly used in DASH for `href`, `actuate`, and other linking attributes. These are treated as extensions and grouped under the `xlink` prefix:

**XML:**
```xml
<Period id="p0" xlink:href="http://example.com/period.xml" xlink:actuate="onLoad">
```

**JSON:**
```json
{
  "$ns": {
    "http://www.w3.org/1999/xlink": "xlink"
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

## Namespace Constraints

The JSON representation imposes the following constraints on namespace usage to keep the format simple, efficient, and unambiguous. These constraints are enforced during XML-to-JSON conversion; documents that violate them are rejected with a descriptive error.

### Root-Only `$ns`

The `$ns` property appears only at the root of the JSON document. All namespace declarations from the XML source (regardless of depth) are hoisted to the root. If hoisting causes a conflict, the document is rejected.

### Unique Prefix Binding

- **One prefix, one URI:** Each prefix maps to exactly one namespace URI.
- **One URI, one prefix:** Each namespace URI maps to exactly one prefix.

Prefix rebinding (same prefix, different URIs at different depths) and URI aliasing (same URI, different prefixes) are both rejected.

### No Prefix Collision with DASH Keys

A namespace prefix must not collide with any DASH element name, DASH attribute name, or reserved property name (`$ns`, `$value`) at the same object level.

### `defaultNs` Constraints

- The synthetic prefix (element local name) must not collide with any DASH element name, DASH attribute name, reserved property name (`$ns`, `$value`), or other declared prefix.
- Each namespace URI may have at most one `defaultNs` entry.
- For complex cases, authors should refactor to use explicit prefixes.

### Rejected XML Patterns

| Pattern | Reason |
|---------|--------|
| Prefix rebinding (`xmlns:p="A"` at root, `xmlns:p="B"` on child) | Prefix ambiguity after hoisting |
| URI aliasing (`xmlns:p1="A"` and `xmlns:p2="A"`) | Ambiguous prefix key |
| Prefix collides with DASH property name | Extension/DASH ambiguity |
| Multiple `defaultNs` elements for same URI | Root `$ns` allows one entry per URI |
| `defaultNs` element name collides with DASH element | Extension/DASH ambiguity |

**Remedy:** In all cases, refactoring the XML to use unique, non-colliding prefixes on the root element resolves the issue.

## Limitations

### Element Order Between Namespaces

When an element contains children from multiple namespaces, the relative order between elements from different namespaces is **not preserved**.

**XML (order: A, B, C):**
```xml
<Parent>
  <ext1:A/>
  <ext2:B/>
  <ext1:C/>
</Parent>
```

**JSON (grouped by namespace):**
```json
{
  "Parent": {
    "ext1": { "A": {}, "C": {} },
    "ext2": { "B": {} }
  }
}
```

The order within each namespace IS preserved (A before C), but the interleaving order is lost.

### No Schema Validation for Extensions

Extension content uses `additionalProperties: true` in the JSON Schema, meaning:
- Extension structures are not validated against any schema
- Any valid JSON structure is accepted under prefix keys
- Validation of extension content is the responsibility of the consuming application

## For Implementers

### Detecting Extension Content

When processing JSON:

1. Read the root `$ns` property to discover declared namespaces
2. Any key matching a declared prefix contains extension content
3. Within extension content, distinguish attributes from elements:
   - Check the `attributes` list in the `$ns` entry for that namespace
   - Keys listed there are XML attributes
   - All other primitive values are text-only XML elements
   - Object/array values are always XML child elements

### Generating XML from JSON

1. Read `$ns` from the root JSON object
2. Add `xmlns:prefix="uri"` declarations to the root `<MPD>` element
3. For `defaultNs` entries, emit `xmlns="uri"` on the element itself
4. For content under prefix keys:
   - Read the `attributes` list from the namespace entry (if present)
   - Emit listed keys as XML attributes (`prefix:name="value"`)
   - Emit other primitive values as text-only XML elements (`<prefix:name>value</prefix:name>`)
   - Emit object/array values as complex XML elements
5. The DASH namespace is always the default (unprefixed)

### Validating Namespace Declarations

When accepting JSON input for conversion to XML, validate:

1. `$ns` appears only at the root
2. No two entries share the same prefix
3. No two entries share the same URI (except stripped namespaces)
4. No prefix collides with DASH element/attribute names at the same level
5. `defaultNs` entries have synthetic prefixes that don't collide

### Example Processing Code

```javascript
// Helper: extract the prefix string from a $ns entry
function getPrefix(entry) {
  return typeof entry === 'string' ? entry : entry.prefix;
}

// Helper: extract attribute names from a $ns entry
function getAttributes(entry) {
  return (typeof entry === 'object' && Array.isArray(entry.attributes))
    ? entry.attributes : [];
}

function processElement(json, namespaces) {
  // Namespaces are read once from root $ns
  if (!namespaces && json.$ns) {
    namespaces = json.$ns;
  }
  
  // Build a prefix -> namespace entry lookup
  const prefixMap = {};
  for (const [uri, entry] of Object.entries(namespaces || {})) {
    prefixMap[getPrefix(entry)] = entry;
  }
  
  for (const [key, value] of Object.entries(json)) {
    if (key === '$ns') continue;
    
    if (key in prefixMap) {
      // Extension content -- process attributes vs elements
      const nsEntry = prefixMap[key];
      const attrNames = getAttributes(nsEntry);
      
      for (const [extKey, extValue] of Object.entries(value)) {
        if (attrNames.includes(extKey)) {
          emitXmlAttribute(`${key}:${extKey}`, extValue);
        } else if (typeof extValue === 'object') {
          emitXmlElement(`${key}:${extKey}`, extValue);
        } else {
          emitXmlTextElement(`${key}:${extKey}`, extValue);
        }
      }
    } else {
      // Standard DASH content
      processDashContent(key, value, namespaces);
    }
  }
}
```

## JSON Schema

The JSON Schema defines extension points with:

```json
{
  "properties": {
    "$ns": {
      "type": "object",
      "additionalProperties": {
        "oneOf": [
          { "type": "string" },
          {
            "type": "object",
            "properties": {
              "prefix": { "type": "string" },
              "attributes": {
                "type": "array",
                "items": { "type": "string" },
                "description": "Attribute local names emitted as XML attributes"
              },
              "defaultNs": {
                "type": "boolean",
                "description": "When true, the namespace was declared as a default namespace redeclaration"
              }
            },
            "required": ["prefix"],
            "additionalProperties": false
          }
        ]
      },
      "description": "Namespace declarations mapping URIs to prefixes or prefix+attributes objects. Appears only at the root level."
    }
  },
  "additionalProperties": true
}
```

Types that support `xs:any` elements include the `x-xml-any: true` extension property.
Types that support `xs:anyAttribute` include the `x-xml-any-attribute: true` extension property.

## CLI Usage

### XML to JSON

```bash
# Convert with namespace handling
npm run mpd2json -- manifest.mpd -o manifest.json

# Skip validation for faster conversion
npm run mpd2json -- manifest.mpd --skip-xsd --skip-json-schema -o manifest.json
```

### JSON to XML

```bash
# Convert back to XML
npm run json2mpd -- manifest.json -o manifest.mpd

# Output to stdout
npm run json2mpd -- manifest.json
```

### Round-trip Example

```bash
# XML -> JSON -> XML
npm run mpd2json -- original.mpd --skip-xsd --skip-json-schema -o intermediate.json
npm run json2mpd -- intermediate.json -o reconstructed.mpd
```

## Complete Example

### Original XML

```xml
<?xml version="1.0" encoding="UTF-8"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011"
     xmlns:ext="urn:example:dash:extension:2026"
     type="static"
     minBufferTime="PT2S"
     profiles="urn:mpeg:dash:profile:isoff-on-demand:2011"
     mediaPresentationDuration="PT60S">

  <Period id="p0" start="PT0S">
    <SupplementalProperty
      schemeIdUri="urn:example:metadata:block"
      value="v1">
      <ext:MetadataBlock version="1.0">
        <ext:ContentId>movie-123</ext:ContentId>
        <ext:Policy>
          <ext:MaxResolution>1920x1080</ext:MaxResolution>
          <ext:AllowedAudioLangs>en,de</ext:AllowedAudioLangs>
        </ext:Policy>
      </ext:MetadataBlock>
    </SupplementalProperty>
  </Period>
</MPD>
```

### Converted JSON

```json
{
  "$ns": {
    "urn:example:dash:extension:2026": "ext"
  },
  "type": "static",
  "minBufferTime": "PT2S",
  "profiles": "urn:mpeg:dash:profile:isoff-on-demand:2011",
  "mediaPresentationDuration": "PT60S",
  "Period": [
    {
      "id": "p0",
      "start": "PT0S",
      "SupplementalProperty": [
        {
          "schemeIdUri": "urn:example:metadata:block",
          "value": "v1",
          "ext": {
            "MetadataBlock": {
              "version": "1.0",
              "ContentId": "movie-123",
              "Policy": {
                "MaxResolution": "1920x1080",
                "AllowedAudioLangs": "en,de"
              }
            }
          }
        }
      ]
    }
  ]
}
```

### Reconstructed XML

```xml
<?xml version="1.0" encoding="UTF-8"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011"
     xmlns:ext="urn:example:dash:extension:2026"
     type="static"
     minBufferTime="PT2S"
     profiles="urn:mpeg:dash:profile:isoff-on-demand:2011"
     mediaPresentationDuration="PT60S">
  <Period id="p0" start="PT0S">
    <SupplementalProperty schemeIdUri="urn:example:metadata:block" value="v1">
      <ext:MetadataBlock version="1.0">
        <ext:ContentId>movie-123</ext:ContentId>
        <ext:Policy>
          <ext:MaxResolution>1920x1080</ext:MaxResolution>
          <ext:AllowedAudioLangs>en,de</ext:AllowedAudioLangs>
        </ext:Policy>
      </ext:MetadataBlock>
    </SupplementalProperty>
  </Period>
</MPD>
```
