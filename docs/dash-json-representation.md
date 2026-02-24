# JSON Representation of DASH MPD

**Status:** Draft

**Version:** 0.1

**Date:** 2026-02-10

## Table of Contents

1. [Introduction](#1-introduction)
2. [Scope](#2-scope)
3. [Normative References](#3-normative-references)
4. [Terms and Definitions](#4-terms-and-definitions)
5. [Motivation](#5-motivation)
6. [General Approach](#6-general-approach)
7. [Schema Conversion: XSD to JSON Schema](#7-schema-conversion-xsd-to-json-schema)
8. [Document Conversion: XML to JSON](#8-document-conversion-xml-to-json)
9. [Namespace Handling](#9-namespace-handling)
10. [Document Conversion: JSON to XML](#10-document-conversion-json-to-xml)
11. [JSON Schema Validation](#11-json-schema-validation)
12. [MPD Patch Documents](#12-mpd-patch-documents)
13. [Remote Element Loading (XLink)](#13-remote-element-loading-xlink)
14. [Conformance](#14-conformance)

---

## 1. Introduction

The MPEG-DASH Media Presentation Description (MPD) is an XML document whose
structure is governed by the MPD XSD schema specified in ISO/IEC 23009-1. While
XML has served the streaming industry well, the broader web development
ecosystem has largely standardized on JSON as the preferred data interchange
format. JavaScript-based clients, REST APIs, and modern tooling all work
natively with JSON, making XML parsing an additional burden for DASH
implementers. Beyond developer ergonomics, parsing speed also matters. On
resource-constrained devices (smart TVs, set-top boxes, and older mobile
platforms), XML parsing can add measurable manifest-update latency, while JSON
parsers are often better optimized.

JSON also fits JavaScript's single-threaded event loop model. Manifest updates
can be fetched and decoded with promise-based APIs (e.g.,
`fetch(...).then(r => r.json())`). Where needed, parsing and conversion can be
offloaded to Web Workers without DOM-based XML parsers. This reduces the
likelihood that frequent MPD refreshes will block the main thread and interfere
with playback logic and UI rendering.

This document specifies a deterministic, schema-driven method for representing
DASH MPD documents in JSON format. The approach ensures:

- **Semantic equivalence** between the XML and JSON representations
- **Round-trip fidelity** - an MPD can be converted from XML to JSON and back to
  XML without loss of information
- **Schema validity** - the JSON representation is derived mechanically from the
  MPD XSD, and can be validated using a generated JSON Schema. The normative
  reference for what is allowed and required remains the MPD XSD (see
  Section 14)
- **Extension preservation** - third-party namespace extensions (DRM signaling,
  proprietary metadata, etc.) survive the conversion
- **Parsing performance** - JSON parsing is natively optimized in JavaScript
  engines and embedded platforms, reducing manifest processing time on
  resource-constrained devices
- **Simplicity** - the JSON representation is designed to be straightforward to
  produce, consume, and validate, even at the cost of restricting certain XML
  namespace patterns that are rarely used in practice

The conversion is not a generic XML-to-JSON mapping. It is specifically designed
for the DASH MPD data model and exploits the structure defined in the MPD XSD to
produce clean, idiomatic JSON that a JavaScript developer would expect. The full
generality of XML namespaces can introduce ambiguity and complexity in JSON. To
avoid this, the specification imposes deliberate constraints. These constraints
cover most real-world DASH content while keeping the JSON format efficient and
easy to parse (see Section 9.7).

## 2. Scope

This document covers:

- The rules for converting the MPD XSD (ISO/IEC 23009-1) into a JSON Schema
  conforming to
  [JSON Schema Draft 2020-12](https://json-schema.org/draft/2020-12)
- The rules for converting an MPD XML document into a conforming JSON document
- The rules for converting a JSON MPD document back into valid XML
- The handling of XML namespaces, extension points, and non-DASH content
- The constraints imposed on XML namespace usage to ensure a clean, efficient,
  and unambiguous JSON representation

This document does not:

- Define a new wire format for DASH manifests (the JSON representation is an
  alternative encoding of the same data model)
- Modify or extend the DASH data model itself
- Specify a transport mechanisms for JSON-encoded MPD
- Provide a general-purpose XML-to-JSON namespace mapping - the constraints in
  Section 9 are specific to the DASH use case and prioritize JSON simplicity
  over full XML namespace generality

## 3. Normative References

| Reference                                                          | Description                                                                                                                       |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| [ISO/IEC 23009-1](https://www.iso.org/standard/83314.html)         | Information technology - Dynamic adaptive streaming over HTTP (DASH) - Part 1: Media presentation description and segment formats |
| [RFC 8259](https://datatracker.ietf.org/doc/html/rfc8259)          | The JavaScript Object Notation (JSON) Data Interchange Format                                                                     |
| [JSON Schema Draft 2020-12](https://json-schema.org/draft/2020-12) | JSON Schema: A Media Type for Describing JSON Documents (draft-bhutton-json-schema-01)                                            |
| [W3C XML Schema 1.0](https://www.w3.org/TR/xmlschema-1/)           | XML Schema Part 1: Structures, Part 2: Datatypes                                                                                  |
| [W3C XLink 1.1](https://www.w3.org/TR/xlink11/)                    | XML Linking Language (XLink) Version 1.1                                                                                          |
| [W3C Namespaces in XML](https://www.w3.org/TR/xml-names/)          | Namespaces in XML 1.0 (Third Edition)                                                                                             |
| `xml-schemas/DASH-MPD.xsd`                                         | Repository reference MPD XSD used as the normative schema for this specification                                                  |

## 4. Terms and Definitions

**MPD** : Media Presentation Description. The XML document describing DASH
content.

**XSD** : XML Schema Definition. The W3C schema language used to define the
structure of the MPD.

**JSON Schema** : A vocabulary for annotating and validating JSON documents.
This document targets
[JSON Schema Draft 2020-12](https://json-schema.org/draft/2020-12).

**DASH namespace** : The XML namespace `urn:mpeg:dash:schema:mpd:2011`, which is
the target namespace of the MPD XSD.

**Extension content** : XML elements or attributes from namespaces other than
the DASH namespace, permitted by `xs:any` and `xs:anyAttribute` wildcards in the
MPD XSD.

**Simple content element** : An XML element whose XSD type is
`xs:simpleContent` - it carries text content and may have attributes.

**`$value`** : The reserved JSON property name used to carry the text content of
a simple content element.

**`$ns`** : The reserved JSON property name used to carry namespace
declarations.

## 5. Motivation

### 5.1 JSON as the Dominant Data Interchange Format

JSON has become one of the dominant data interchange formats across the software
industry. It is the default for REST APIs, cloud services, configuration
systems, and interprocess communication. Most programming languages - including
JavaScript, Python, Go, Rust, Swift, and Kotlin - provide native or
standard-library JSON parsers, making it a universally accessible format with
minimal integration effort.

On the web platform specifically, JSON is a first-class primitive: browser APIs
(`fetch`, `Response.json()`), server frameworks, and client-side tooling all
operate on JSON natively. DASH client implementations in JavaScript must
currently parse XML MPDs using either the DOM API or a third-party XML parser,
then manually extract attributes and elements into JavaScript objects. This
impedance mismatch adds complexity, code size, and potential for bugs - and the
same applies to DASH implementations on other platforms where XML parsing
requires a dedicated library while JSON parsing is built-in.

### 5.2 Parsing Performance on Constrained Devices

While XML parsing libraries are widely available and mature, their performance
characteristics vary significantly across platforms. DASH clients run on a broad
range of devices, from high-end desktop browsers to embedded platforms such as
smart TVs (WebOS, Tizen), game consoles, and older set-top boxes. On these
constrained environments, XML parsing can become a bottleneck - particularly for
large manifests with extensive `SegmentTimeline` elements, many `Representation`
entries, or multiple Periods.

JSON parsers, by contrast, are a core primitive in JavaScript engines and are
typically implemented in optimized native code (`JSON.parse()`). They benefit
from years of engine-level optimization driven by the central role JSON plays in
web APIs. On platforms where XML parsing relies on a less-optimized DOM
implementation or a JavaScript-based parser, the performance gap can be
significant.

A JSON representation of the MPD allows DASH clients on these platforms to
eliminate XML parsing entirely from the manifest processing path, reducing
latency during initial load and periodic manifest refreshes in live streaming
scenarios.

### 5.3 Limitations of Ad-Hoc Conversion

Existing DASH players typically implement their own XML-to-object mapping, each
with different conventions for handling attributes, child elements, text
content, and type coercion. These ad-hoc approaches:

- Are not standardized across implementations
- Do not produce output that can be validated against a schema
- Often lose type information (treating all values as strings)
- Handle extension content inconsistently or not at all
- Cannot guarantee round-trip fidelity

### 5.4 Namespace Simplicity as a Design Goal

XML namespaces provide a powerful mechanism for mixing vocabularies within a
single document. However, their full generality - prefix rebinding, default
namespace re-declaration at arbitrary depths, and multiple prefixes for the same
URI - creates significant challenges when mapping to JSON:

- **JSON objects are property-name-keyed.** Extension content is grouped under a
  prefix key (e.g., `"cenc": { ... }`). If the same prefix can bind to different
  URIs at different depths, the flat property-name model breaks down.
- **JSON has no native namespace concept.** Encoding full XML namespace dynamics
  into JSON requires auxiliary metadata that complicates the format, increases
  payload size, and makes the JSON harder to produce and consume.
- **Real-world DASH content is simple.** Analysis of DASH MPD documents in
  production shows that virtually all extension namespaces are declared once on
  the root `<MPD>` element with a single, document-wide prefix. Complex
  namespace patterns (prefix rebinding, default namespace re-declarations on
  deeply nested elements) are rare in the DASH ecosystem.

This specification therefore imposes deliberate constraints on namespace usage
(detailed in Section 9.7) that cover the vast majority of real-world DASH
content while keeping the JSON representation clean, efficient, and easy to
implement. MPD authors whose content falls outside these constraints can
refactor their namespace declarations (typically by moving all declarations to
the root element with unique prefixes).

### 5.5 Goals of This Specification

This specification provides a single, deterministic mapping that:

1. **Preserves the DASH data model** - every construct in the MPD XSD has a
   defined JSON representation
2. **Enables schema validation** - the JSON Schema is mechanically derived from
   the MPD XSD to ensure that validity in one domain implies validity in the
   other
3. **Produces idiomatic JSON** - the output looks like JSON a developer would
   write by hand, not a mechanical XML dump
4. **Supports round-trip conversion** - XML to JSON to XML preserves semantic
   equivalence
5. **Handles extensions** - namespace-qualified content from any namespace is
   preserved and can be reconstructed
6. **Improves parsing performance** - enables DASH clients to leverage
   platform-native JSON parsing, which is particularly beneficial on
   resource-constrained devices
7. **Maintains simplicity** - the JSON format is straightforward to produce,
   consume, and validate, imposing minimal namespace-related complexity on
   implementers

## 6. General Approach

The conversion operates at two levels:

1. **Schema level:** The MPD XSD is converted to a JSON Schema that defines the
   structure and types of valid JSON MPD documents.
2. **Document level:** Individual MPD XML documents are converted to JSON
   documents that conform to the generated JSON Schema.

Both conversions are **schema-driven**: the MPD XSD determines how each XML
construct maps to JSON. This is fundamentally different from generic XML-to-JSON
converters, which must use heuristics because they lack schema information.

### 6.1 Design Principles

#### 6.1.1 Attributes Are Properties

XML attributes become direct properties on the JSON object that represents the
element. There is no prefix or special marker to distinguish them from child
elements. This works because the MPD XSD guarantees that attribute names and
child element names within the same type do not collide.

**XML:**

```xml
<AdaptationSet id="1" mimeType="video/mp4" codecs="avc1.64001f">
```

**JSON:**

```json
{
  "id": 1,
  "mimeType": "video/mp4",
  "codecs": "avc1.64001f"
}
```

#### 6.1.2 Child Elements Are Properties

Child elements also become properties on the parent object. The property name is
the element's local name (without namespace prefix for DASH namespace elements).
The MPD XSD follows the DASH naming convention that element names are
`UpperCamelCase` while attribute names are lower `camelCase`, which helps ensure
these JSON property names do not collide.

**XML:**

```xml
<Period id="p0">
  <AdaptationSet id="1" mimeType="video/mp4">
    <Representation id="v1" bandwidth="5000000"/>
  </AdaptationSet>
</Period>
```

**JSON:**

```json
{
  "id": "p0",
  "AdaptationSet": [
    {
      "id": 1,
      "mimeType": "video/mp4",
      "Representation": [
        {
          "id": "v1",
          "bandwidth": 5000000
        }
      ]
    }
  ]
}
```

#### 6.1.3 Repeated Elements Are Arrays

Any element that can appear more than once (i.e., `maxOccurs` > 1 in the MPD
XSD) is always represented as a JSON array, even when only one instance is
present. This ensures structural consistency - consumers can always expect an
array and do not need to check whether a value is an object or an array.

**XML:**

```xml
<Period id="p0">...</Period>
```

**JSON:**

```json
{
  "Period": [{ "id": "p0" }]
}
```

#### 6.1.4 Singleton Elements Are Objects

Elements that can appear at most once (`maxOccurs` = 1) are represented directly
as objects (not wrapped in arrays).

**XML:**

```xml
<SegmentBase indexRange="0-999">
  <Initialization range="0-999"/>
</SegmentBase>
```

**JSON:**

```json
{
  "SegmentBase": {
    "indexRange": "0-999",
    "Initialization": {
      "range": "0-999"
    }
  }
}
```

#### 6.1.5 Text Content Uses $value

When an element has `xs:simpleContent` in its MPD XSD type definition (meaning
it carries text content and may also have attributes), the text is placed in a
special `$value` property. This applies consistently whenever the _schema_
defines possible attributes, even if a particular instance has no attributes
present. The `$` prefix avoids collision with any MPD XSD-defined attribute or
element name. At the same time, `$` is not a reserved character in JavaScript
and can be used fluently when accessing properties (i.e. `BaseURL[0].$value`).

**XML:**

```xml
<BaseURL availabilityTimeOffset="5.0">https://example.com/video/</BaseURL>
```

**JSON:**

```json
{
  "$value": "https://example.com/video/",
  "availabilityTimeOffset": 5.0
}
```

When the schema defines a text-only element with no possible attributes, the
element maps to a plain string (no `$value` wrapper):

**XML:**

```xml
<Title>Sample DASH Content</Title>
```

**JSON:**

```json
{
  "Title": "Sample DASH Content"
}
```

#### 6.1.6 Types Are Coerced

XML represents all values as strings. JSON has distinct types for strings,
numbers, booleans, and null. The conversion uses the MPD XSD type information to
coerce values to their appropriate JSON types:

| XSD Type                                               | JSON Schema Type | Example XML                    | Example JSON    |
| ------------------------------------------------------ | ---------------- | ------------------------------ | --------------- |
| `xs:string`, `xs:anyURI`, `xs:duration`, `xs:dateTime` | `string`         | `codecs="avc1.64001f"`         | `"avc1.64001f"` |
| `xs:integer`, `xs:unsignedInt`, `xs:long`              | `integer`        | `bandwidth="5000000"`          | `5000000`       |
| `xs:double`, `xs:float`                                | `number`         | `availabilityTimeOffset="5.0"` | `5.0`           |
| `xs:boolean`                                           | `boolean`        | `segmentAlignment="true"`      | `true`          |

The `ConditionalUintType` defined in the MPD XSD (a union of boolean and
unsigned integer) is represented as a JSON Schema `oneOf` allowing either type.

Note: The MPD XSD uses integer types such as `xs:unsignedLong` whose value space
can exceed the IEEE-754 safe integer range used by many JSON runtimes (notably
JavaScript). This specification keeps these values as JSON numbers for
compatibility. Implementations MAY lose numeric precision for sufficiently large
values; conformance is ultimately determined by whether the JSON can be
serialized into XSD-valid XML (Section 14).

#### 6.1.7 XSD List Types Are Arrays

XSD `xs:list` types (space-separated values in a single attribute) become JSON
arrays. For example, `UIntVectorType` (a list of unsigned integers) becomes an
array of integers.

**XML:**

```xml
<AdaptationSet audioSamplingRate="48000">
```

**JSON:**

```json
{
  "audioSamplingRate": [48000]
}
```

Similarly, `StringVectorType` (space-separated strings) becomes an array of
strings.

### 6.2 Element Ordering

The DASH specification assigns semantic meaning to the order of certain
elements. For example:

- **`BaseURL`** - when multiple `BaseURL` elements are present at the same
  level, the first is used as the default in the absence of other criteria
  (ISO/IEC 23009-1, 5.6.5)
- **`Period`** - consecutive `Period` elements define the media timeline in
  presentation order
- **`S`** - elements within a `SegmentTimeline` appear in segment numbering/time
  order
- **`UTCTiming`** - the order of `UTCTiming` elements in the MPD expresses the
  author's preference for UTC synchronization methods
- **`Event`** - events within an `EventStream` are ordered by presentation time

All of these order-significant elements are defined with `maxOccurs="unbounded"`
in the MPD XSD and are represented as JSON arrays in the JSON Schema. Since JSON
arrays are ordered by definition (RFC 8259), the element order is naturally
preserved.

Implementations MUST preserve the order of array elements during conversion in
both directions (XML to JSON and JSON to XML). The order of items in a JSON
array MUST match the order of the corresponding XML child elements.

#### 6.2.1 Sibling Order of Distinct Child Elements

The MPD XSD uses `xs:sequence` to define the order in which different child
element types appear within a parent (e.g., within a `Period`, `BaseURL`
elements must appear before `AdaptationSet` elements). In JSON, these different
child element types become distinct properties on the parent object. Since the
JSON specification does not define ordering for object properties, this sibling
order between different element types cannot be guaranteed.

In practice, this is not a semantic concern: the DASH specification does not
assign meaning to the relative ordering of _different_ child element types. A
client accesses `BaseURL` and `AdaptationSet` by property name, not by their
relative position. The `xs:sequence` constraint is an XSD schema validation
concern, not a data model requirement.

#### 6.2.2 Property Ordering Recommendation

While there is no required ordering of properties within a JSON object, for
readability, implementations SHOULD emit properties in the following order:

1. `$ns` (namespace declarations, if present)
2. XML attributes (in schema definition order)
3. Child elements (in schema definition order)

## 7. Schema Conversion: XSD to JSON Schema

The MPD XSD is mechanically converted to a
[JSON Schema Draft 2020-12](https://json-schema.org/draft/2020-12) document that
provides a validation artifact that can be checked automatically for the JSON
representation. Because the MPD XSD includes wildcard extension points (`xs:any`
and `xs:anyAttribute`), the generated JSON Schema is necessarily permissive in
those areas (e.g., via `additionalProperties: true`). Conformance is therefore
defined against the MPD XSD, using JSON-to-XML serialization (Section 14).

### 7.0.1 XML Mapping Annotations

The generated JSON Schema MAY include non-standard, informational annotations to
help implementations reconstruct XML faithfully. These annotations are not part
of JSON Schema Draft 2020-12 and MUST NOT affect validation results.

- `x-xml-attribute: true`: Indicates the property corresponds to an XML
  attribute in the MPD XSD.

### 7.1 Overall Structure

The generated JSON Schema uses `$defs` to define all types. The root schema
references the `MPDtype` definition:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$ref": "#/$defs/MPDtype",
  "description": "MPD: main element"
}
```

Each named `xs:complexType` and `xs:simpleType` in the MPD XSD becomes a named
definition in `$defs`. The type name is preserved as-is (e.g., `PeriodType`,
`AdaptationSetType`, `SegmentBaseType`).

### 7.2 Complex Types

An `xs:complexType` with a sequence of child elements and attributes maps to a
JSON Schema `object`:

**XSD:**

```xml
<xs:complexType name="PeriodType">
  <xs:sequence>
    <xs:element name="BaseURL" type="BaseURLType" maxOccurs="unbounded" minOccurs="0"/>
    <xs:element name="AdaptationSet" type="AdaptationSetType" maxOccurs="unbounded" minOccurs="0"/>
  </xs:sequence>
  <xs:attribute name="id" type="xs:string"/>
  <xs:attribute name="start" type="xs:duration"/>
  <xs:attribute name="duration" type="xs:duration"/>
</xs:complexType>
```

**JSON Schema:**

```json
{
  "PeriodType": {
    "type": "object",
    "properties": {
      "BaseURL": {
        "type": "array",
        "items": { "$ref": "#/$defs/BaseURLType" }
      },
      "AdaptationSet": {
        "type": "array",
        "items": { "$ref": "#/$defs/AdaptationSetType" }
      },
      "id": { "type": "string" },
      "start": { "type": "string", "format": "iso-duration" },
      "duration": { "type": "string", "format": "iso-duration" }
    }
  }
}
```

Key rules:

- **Child elements** with `maxOccurs="unbounded"` (or > 1) become
  `"type": "array"` with `"items"` referencing the element's type.
- **Child elements** with `maxOccurs="1"` become direct `$ref` references (no
  array wrapper).
- **Required child elements** (`minOccurs` >= 1) are listed in the `"required"`
  array.
- **Attributes** become properties with types mapped per Section 7.5.
- **Required attributes** (`use="required"`) are listed in `"required"`.
- **Fixed attributes** use `"const"` in JSON Schema.
- **Default attribute values** use `"default"`.

### 7.3 Simple Types

XSD simple types with restrictions map to JSON Schema with constraints:

**XSD:**

```xml
<xs:simpleType name="PresentationType">
  <xs:restriction base="xs:string">
    <xs:enumeration value="static"/>
    <xs:enumeration value="dynamic"/>
  </xs:restriction>
</xs:simpleType>
```

**JSON Schema:**

```json
{
  "PresentationType": {
    "type": "string",
    "enum": ["static", "dynamic"]
  }
}
```

| XSD Restriction Facet | JSON Schema Keyword       |
| --------------------- | ------------------------- |
| `xs:enumeration`      | `enum`                    |
| `xs:pattern`          | `pattern`                 |
| `xs:minInclusive`     | `minimum`                 |
| `xs:maxInclusive`     | `maximum`                 |
| `xs:minExclusive`     | `exclusiveMinimum`        |
| `xs:maxExclusive`     | `exclusiveMaximum`        |
| `xs:minLength`        | `minLength`               |
| `xs:maxLength`        | `maxLength`               |
| `xs:length`           | `minLength` + `maxLength` |
| `xs:whiteSpace`       | _(not mapped)_            |

Note: The `xs:whiteSpace` facet controls whether an XML parser preserves,
replaces, or collapses whitespace in string values. JSON has no equivalent
mechanism - whitespace in JSON string values is always preserved as-is. This is
not a practical concern for the MPD XSD, which does not use the `xs:whiteSpace`
facet on any of its type definitions. The built-in XSD types used in the MPD
(such as `xs:string`, `xs:anyURI`, and `xs:token`) carry implicit whitespace
rules that are already applied by the XML parser before the value reaches the
converter.

### 7.4 Simple Content

XSD types with `xs:simpleContent` (text content with attributes) map to JSON
objects with a `$value` property:

**XSD:**

```xml
<xs:complexType name="BaseURLType">
  <xs:simpleContent>
    <xs:extension base="xs:anyURI">
      <xs:attribute name="serviceLocation" type="xs:string"/>
      <xs:attribute name="byteRange" type="xs:string"/>
      <xs:attribute name="availabilityTimeOffset" type="xs:double"/>
    </xs:extension>
  </xs:simpleContent>
</xs:complexType>
```

**JSON Schema:**

```json
{
  "BaseURLType": {
    "type": "object",
    "properties": {
      "$value": { "type": "string", "format": "uri-reference" },
      "serviceLocation": { "type": "string" },
      "byteRange": { "type": "string" },
      "availabilityTimeOffset": { "type": "number" }
    },
    "required": ["$value"]
  }
}
```

The `$value` property carries the text content with the base type's constraints.
It is always required because an `xs:simpleContent` element must have text
content.

### 7.5 Built-in Type Mapping

XSD built-in types map to JSON Schema types as follows:

| XSD Type                              | JSON Schema Type | Format / Notes                       |
| ------------------------------------- | ---------------- | ------------------------------------ |
| `xs:string`                           | `string`         |                                      |
| `xs:normalizedString`, `xs:token`     | `string`         |                                      |
| `xs:language`                         | `string`         | `pattern` for BCP 47                 |
| `xs:anyURI`                           | `string`         | `format: "uri-reference"`            |
| `xs:integer`, `xs:int`, `xs:long`     | `integer`        | With appropriate `minimum`/`maximum` |
| `xs:unsignedInt`, `xs:unsignedLong`   | `integer`        | `minimum: 0`                         |
| `xs:double`, `xs:float`, `xs:decimal` | `number`         |                                      |
| `xs:boolean`                          | `boolean`        |                                      |
| `xs:duration`                         | `string`         | `format: "iso-duration"`             |
| `xs:dateTime`                         | `string`         | `format: "iso-date-time"`            |
| `xs:date`                             | `string`         | `format: "date"`                     |
| `xs:base64Binary`                     | `string`         | `contentEncoding: "base64"`          |
| `xs:hexBinary`                        | `string`         | `pattern` for hex characters         |

Note: The `iso-duration` and `iso-date-time` formats are used instead of the
standard `duration` and `date-time` formats because XSD `duration`/`dateTime`
follows ISO 8601 (which permits fractional seconds and optional timezones),
while JSON Schema's built-in formats follow RFC 3339 (which is more
restrictive).

### 7.6 Complex Content and Inheritance

XSD type extension (`xs:complexContent` with `xs:extension`) maps to JSON Schema
`allOf`:

**XSD:**

```xml
<xs:complexType name="AdaptationSetType">
  <xs:complexContent>
    <xs:extension base="RepresentationBaseType">
      <xs:sequence>
        <xs:element name="Representation" type="RepresentationType" maxOccurs="unbounded" minOccurs="0"/>
      </xs:sequence>
      <xs:attribute name="id" type="xs:unsignedInt"/>
    </xs:extension>
  </xs:complexContent>
</xs:complexType>
```

**JSON Schema:**

```json
{
  "AdaptationSetType": {
    "allOf": [
      { "$ref": "#/$defs/RepresentationBaseType" },
      {
        "type": "object",
        "properties": {
          "Representation": {
            "type": "array",
            "items": { "$ref": "#/$defs/RepresentationType" }
          },
          "id": { "type": "integer", "minimum": 0 }
        }
      }
    ]
  }
}
```

### 7.7 XSD Choice

`xs:choice` maps to JSON Schema `oneOf` (or `anyOf` for optional choices):

**XSD:**

```xml
<xs:choice>
  <xs:element name="SegmentBase" type="SegmentBaseType"/>
  <xs:element name="SegmentList" type="SegmentListType"/>
  <xs:element name="SegmentTemplate" type="SegmentTemplateType"/>
</xs:choice>
```

**JSON Schema:**

```json
{
  "oneOf": [
    {
      "properties": {
        "SegmentBase": { "$ref": "#/$defs/SegmentBaseType" }
      }
    },
    {
      "properties": {
        "SegmentList": { "$ref": "#/$defs/SegmentListType" }
      }
    },
    {
      "properties": {
        "SegmentTemplate": { "$ref": "#/$defs/SegmentTemplateType" }
      }
    }
  ]
}
```

### 7.8 XSD List Types

XSD `xs:list` types map to JSON arrays:

**XSD:**

```xml
<xs:simpleType name="UIntVectorType">
  <xs:list itemType="xs:unsignedInt"/>
</xs:simpleType>
```

**JSON Schema:**

```json
{
  "UIntVectorType": {
    "type": "array",
    "items": { "type": "integer", "minimum": 0 }
  }
}
```

Similarly, `StringVectorType` (a list of strings) becomes
`"type": "array", "items": { "type": "string" }`.

In XML, list values are space-separated within a single attribute value. In
JSON, they are proper arrays.

### 7.9 Extension Points

XSD `xs:any` and `xs:anyAttribute` wildcards permit content from other
namespaces. These map to JSON Schema as follows:

- **`xs:any`**: The type gets `additionalProperties: true` and a custom marker
  `x-xml-any: true`.
- **`xs:anyAttribute`**: The type gets a custom marker
  `x-xml-any-attribute: true`.
- **`$ns` support**: The root JSON Schema defines the `$ns` property at the top
  level only. Types with `xs:any` or `xs:anyAttribute` accept extension prefix
  keys via `additionalProperties: true`. Namespace declarations themselves
  appear only at the root (see Section 9.2).

This means extension content is structurally permitted by the JSON Schema but
not validated against any extension-specific schema. Validation of extension
content is the responsibility of the consuming application.

## 8. Document Conversion: XML to JSON

This section specifies how an MPD XML document instance is converted to a JSON
document that conforms to the JSON Schema defined in Section 7.

### 8.1 Root Element

The XML root element `<MPD>` becomes the root JSON object. The element name is
not represented as a property (it is implicit from the schema's `$ref` to
`MPDtype`). The XML declaration and processing instructions are discarded.

**XML:**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011"
     profiles="urn:mpeg:dash:profile:isoff-on-demand:2011"
     type="static"
     mediaPresentationDuration="PT30S"
     minBufferTime="PT2S">
  ...
</MPD>
```

**JSON:**

```json
{
  "profiles": "urn:mpeg:dash:profile:isoff-on-demand:2011",
  "type": "static",
  "mediaPresentationDuration": "PT30S",
  "minBufferTime": "PT2S"
}
```

### 8.2 Attributes

XML attributes map to properties on the enclosing JSON object. The attribute
name becomes the property key. The value is coerced to the JSON type specified
by the MPD XSD (see Section 8.5).

The following attributes and namespace declarations are **not** carried over:

- `xmlns` and `xmlns:*` declarations (handled via `$ns`; see Section 9)
- `xsi:schemaLocation` and `xsi:noNamespaceSchemaLocation` (XML Schema Instance
  attributes have no meaning in JSON)

### 8.3 Child Elements

Each child element becomes a property on the parent JSON object:

- **Array elements** (MPD XSD `maxOccurs` > 1): The property value is an array.
  Each occurrence of the element is an item in the array. If only one occurrence
  exists, it is still wrapped in a single-element array.
- **Singleton elements** (MPD XSD `maxOccurs` = 1): The property value is the
  element's JSON representation directly (not wrapped in an array).
- **Empty elements** (`<Element/>` or `<Element></Element>`): Represented as an
  empty object `{}` for complex types, or an object with just `$value` for
  simple content types.

Whether an element is treated as an array or singleton is determined by the JSON
Schema (which was derived from the MPD XSD).

### 8.4 Text Content

Text content handling depends on the element's type in the MPD XSD:

1. **Simple content with possible attributes** (`xs:simpleContent` in the MPD
   XSD): Text goes in the `$value` property. This applies even when no
   attributes are present in a particular instance, ensuring structural
   consistency.

   ```json
   { "$value": "https://example.com/video/" }
   ```

2. **Text-only elements** (no attributes defined in the schema): The element
   maps directly to a string value.

   ```json
   { "Title": "Sample DASH Content" }
   ```

3. **Mixed content**: Text goes in `$value` alongside child elements. In the MPD
   XSD, the only mixed-content type is `EventType` (the `Event` element), which
   can contain both text and child elements such as `SupplementalProperty` or
   extension content.

### 8.5 Type Coercion

All values in XML are strings. The converter uses the MPD XSD type information
(via the generated JSON Schema) to coerce values to their correct JSON types:

- **Integers**: String values matching XSD integer types are parsed to JSON
  integers. Example: `bandwidth="5000000"` becomes `5000000`.
- **Numbers**: String values matching XSD float/double types are parsed to JSON
  numbers. Example: `availabilityTimeOffset="5.0"` becomes `5.0`.
- **Booleans**: `"true"` and `"false"` become JSON `true` and `false`. The XSD
  boolean values `"1"` and `"0"` are also accepted and converted to `true` and
  `false`.
- **Strings**: All other values remain as strings. This includes values that
  look numeric but are defined as strings in the MPD XSD (e.g.,
  `frameRate="30/1"`, `Representation@id`).
- **Lists**: Space-separated attribute values for XSD list types are split into
  JSON arrays with each item coerced to the list's item type. Example:
  `audioSamplingRate="48000 44100"` becomes `[48000, 44100]`.

### 8.6 Complete Example

**XML:**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011"
     profiles="urn:mpeg:dash:profile:isoff-on-demand:2011"
     type="static"
     mediaPresentationDuration="PT30S"
     minBufferTime="PT2S">
  <ProgramInformation>
    <Title>Sample DASH Content</Title>
    <Source>Test Generator</Source>
  </ProgramInformation>
  <Period id="period1" duration="PT30S">
    <AdaptationSet id="1" mimeType="video/mp4" codecs="avc1.64001f"
                   width="1920" height="1080" frameRate="30">
      <Representation id="video1" bandwidth="5000000">
        <BaseURL>video/1080p/</BaseURL>
        <SegmentBase indexRange="0-999">
          <Initialization range="0-999"/>
        </SegmentBase>
      </Representation>
    </AdaptationSet>
  </Period>
</MPD>
```

**JSON:**

```json
{
  "profiles": "urn:mpeg:dash:profile:isoff-on-demand:2011",
  "type": "static",
  "mediaPresentationDuration": "PT30S",
  "minBufferTime": "PT2S",
  "ProgramInformation": [
    {
      "Title": "Sample DASH Content",
      "Source": "Test Generator"
    }
  ],
  "Period": [
    {
      "id": "period1",
      "duration": "PT30S",
      "AdaptationSet": [
        {
          "id": 1,
          "mimeType": "video/mp4",
          "codecs": "avc1.64001f",
          "width": 1920,
          "height": 1080,
          "frameRate": "30",
          "Representation": [
            {
              "id": "video1",
              "bandwidth": 5000000,
              "BaseURL": [
                {
                  "$value": "video/1080p/"
                }
              ],
              "SegmentBase": {
                "indexRange": "0-999",
                "Initialization": {
                  "range": "0-999"
                }
              }
            }
          ]
        }
      ]
    }
  ]
}
```

Notable aspects of this example:

- `AdaptationSet@id` is an integer (`1`) because the MPD XSD defines it as
  `xs:unsignedInt`
- `Representation@id` is a string (`"video1"`) because the MPD XSD defines it as
  `xs:string`
- `frameRate` is a string (`"30"`) because the MPD XSD type `FrameRateType` uses
  a pattern (allowing `"30/1"`)
- `width` and `height` are integers
- `BaseURL` uses the `$value` wrapper because `BaseURLType` is
  `xs:simpleContent` with optional attributes
- `ProgramInformation`, `Period`, `AdaptationSet`, and `Representation` are
  arrays (even with single items) because they allow `maxOccurs` > 1
- `SegmentBase` and `Initialization` are direct objects (not arrays) because
  they are singletons

## 9. Namespace Handling

DASH MPDs can contain elements and attributes from namespaces other than the
core DASH namespace. Common examples include Common Encryption (CENC), XLink,
PlayReady (MSPR), and proprietary vendor extensions. The MPD XSD permits this
via `xs:any` and `xs:anyAttribute` wildcards.

This section specifies how namespace-qualified content is represented in JSON,
including the constraints imposed to ensure a clean and efficient JSON format.

### 9.1 The DASH Namespace

The DASH namespace (`urn:mpeg:dash:schema:mpd:2011`) is the **implicit default**
namespace in the JSON representation. Elements and attributes in this namespace
appear as plain properties without any prefix or namespace marker. The DASH
`xmlns` declaration is not included in the JSON output.

### 9.2 The `$ns` Property

All other namespace declarations are collected into a single `$ns` property on
the **root** JSON object. The `$ns` property maps namespace URIs to prefix
information and provides a document-wide, flat namespace registry.

The `$ns` property SHALL only appear at the root level of the JSON document.
Nested `$ns` declarations are not permitted (see Section 9.7 for rationale).

Each entry in `$ns` takes one of two forms:

#### Simple Form

When a namespace defines only extension elements (no extension attributes):

```json
{
  "$ns": {
    "urn:example:dash:extension:2026": "ext"
  }
}
```

The value is a string containing the namespace prefix.

#### Extended Form

When a namespace defines extension attributes in addition to (or instead of)
elements:

```json
{
  "$ns": {
    "urn:mpeg:cenc:2013": {
      "prefix": "cenc",
      "attributes": ["default_KID"]
    }
  }
}
```

The value is an object with:

- `prefix` (required): The namespace prefix used in the original XML.
- `attributes` (optional): An array of local names that are XML attributes (not
  child elements). This disambiguates attributes from text-only child elements,
  which are both represented as plain strings in JSON.
- `defaultNs` (optional, boolean): When `true`, indicates the namespace was
  declared as a default namespace redeclaration (`xmlns="..."`) on an extension
  element rather than using a prefix. When converting from JSON to XML, this
  causes the converter to emit `xmlns="..."` on the element itself instead of a
  prefixed `xmlns:prefix="..."` declaration on the root. See Section 9.4 for
  constraints.

#### Why the `attributes` List Is Needed

In XML, the distinction between `cenc:default_KID="value"` (attribute) and
`<cenc:pssh>value</cenc:pssh>` (child element) is syntactically obvious. In
JSON, both are represented as `"default_KID": "value"` and `"pssh": "value"` -
plain string properties. The `attributes` list resolves this ambiguity by
explicitly declaring which names are attributes.

### 9.3 Extension Content Representation

Extension elements and attributes from a given namespace are grouped under a
single property whose key is the namespace prefix.

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
  "Period": [
    {
      "AdaptationSet": [
        {
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
        }
      ]
    }
  ]
}
```

Key rules:

1. **All extension content is grouped under the prefix key.** Both `default_KID`
   (an attribute) and `pssh` (a child element) appear under `"cenc": {...}`.
2. **Children within extension content inherit the namespace.** Nested extension
   elements do not repeat the prefix in their JSON key names.
3. **Object and array values are always child elements.** Only primitive
   (string/number/boolean) values need the `attributes` list for disambiguation.

### 9.4 Default Namespace Redeclaration (`defaultNs`)

Some extension elements in XML use a default namespace redeclaration instead of
a prefix. For instance, PlayReady content may appear as:

**XML:**

```xml
<ContentProtection schemeIdUri="urn:uuid:9a04f079-9840-4286-ab92-e65be0885f95">
  <pro xmlns="urn:microsoft:playready">base64data...</pro>
</ContentProtection>
```

Here, the `<pro>` element has no prefix - it uses `xmlns="..."` to place itself
in the PlayReady namespace. In JSON, the element's local name (`pro`) is used as
a synthetic prefix:

**JSON:**

```json
{
  "$ns": {
    "urn:microsoft:playready": { "prefix": "pro", "defaultNs": true }
  },
  "ContentProtection": [
    {
      "schemeIdUri": "urn:uuid:9a04f079-9840-4286-ab92-e65be0885f95",
      "pro": {
        "$value": "base64data..."
      }
    }
  ]
}
```

The `defaultNs: true` flag tells the JSON-to-XML converter to reconstruct
`<pro xmlns="urn:microsoft:playready">` rather than declaring
`xmlns:pro="urn:microsoft:playready"` and emitting `<pro:pro>`.

Because `defaultNs` uses the element's local name as a synthetic prefix, it is
subject to additional constraints (see Section 9.7).

### 9.5 XLink Namespace

XLink (`http://www.w3.org/1999/xlink`) is a well-known attribute-only namespace
used in DASH for remote element loading. Because XLink defines only attributes
(never child elements), all primitive values under the `xlink` prefix key are
treated as attributes by default, without needing an explicit `attributes` list.

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
  "Period": [
    {
      "id": "p0",
      "xlink": {
        "href": "http://example.com/period.xml",
        "actuate": "onLoad"
      }
    }
  ]
}
```

The XLink attributes are grouped under the `"xlink"` prefix key, consistent with
the general namespace handling rules (Section 9.3). Section 13 specifies how
clients resolve these remote element references and merge the results back into
the MPD.

### 9.6 Stripped Namespaces

The following namespaces are stripped during conversion and do not appear in the
JSON output:

- **XML Schema Instance** (`http://www.w3.org/2001/XMLSchema-instance`): The
  `xsi:schemaLocation` and `xsi:noNamespaceSchemaLocation` attributes are XML
  tooling hints and have no semantic meaning in JSON.
- **The DASH namespace itself** (`urn:mpeg:dash:schema:mpd:2011`): This is the
  implicit default; its elements are represented as plain properties.

### 9.7 Namespace Constraints

The JSON representation imposes the following constraints on namespace usage.
These constraints ensure that the `$ns` property remains a simple, flat,
document-wide registry and that extension content can be unambiguously mapped to
and from XML. A conforming XML-to-JSON converter SHALL reject input that
violates these constraints with a descriptive error message.

#### 9.7.1 Document-Wide `$ns` (No Nested Scoping)

The `$ns` property SHALL only appear at the root level of the JSON document.
Nested `$ns` declarations within child objects are not permitted.

**Rationale:** XML allows namespace declarations at any depth, with inner
declarations shadowing outer ones. Replicating this scoping model in JSON would
require consumers to walk up the object tree to resolve a prefix, negating the
simplicity benefits of JSON. Because real-world DASH MPDs most often declare all
namespaces on the root `<MPD>` element, this restriction has no practical
impact.

When converting XML to JSON, all namespace declarations found at any depth in
the XML document are hoisted to the root `$ns`. If this hoisting would cause a
conflict (see below), the converter SHALL reject the document.

#### 9.7.2 Unique Prefix Binding

Each namespace prefix SHALL map to exactly one namespace URI within a document,
and each namespace URI SHALL map to exactly one prefix.

- **No prefix rebinding:** If `xmlns:ext="urn:ns:A"` appears at one level and
  `xmlns:ext="urn:ns:B"` appears at another, the document is rejected because
  the prefix `ext` would be ambiguous after hoisting.
- **No URI aliasing:** If `xmlns:ext1="urn:ns:A"` and `xmlns:ext2="urn:ns:A"`
  both appear, the document is rejected because the same URI would have two
  prefixes, making it unclear which prefix key to use in the JSON output.

**Rationale:** The JSON representation groups extension content under a prefix
key (e.g., `"cenc": { ... }`). This model requires a one-to-one mapping between
prefixes and URIs. Allowing many-to-one or one-to-many mappings would create
ambiguity in both directions of conversion.

#### 9.7.3 No Prefix Collision with Reserved or DASH Keys

A namespace prefix SHALL NOT collide with:

- The reserved property names `$ns` and `$value`.
- Any DASH element or attribute name defined in the MPD XSD at the same object
  level where the prefix key would appear. For example, a prefix named `Period`
  or `type` would collide with the DASH `Period` element and `type` attribute.

**Rationale:** Extension content appears as a property alongside DASH
properties. If a prefix matches a DASH property name, the converter cannot
distinguish extension content from standard DASH content.

#### 9.7.4 Constraints on `defaultNs` Usage

The `defaultNs` mechanism (Section 9.4) is supported with the following
constraints:

- The synthetic prefix (the element's local name) SHALL NOT collide with any
  DASH element name, DASH attribute name, reserved property name (`$ns`,
  `$value`), or any other declared prefix in the same document.
- Each namespace URI SHALL have at most one `defaultNs` entry in the root `$ns`.
  If multiple elements with different local names use `xmlns="..."` to declare
  the same namespace URI, the document is rejected.
- MPD authors requiring complex unprefixed extension content SHOULD refactor to
  use explicit namespace prefixes (e.g., `xmlns:mspr="urn:microsoft:playready"`
  with `<mspr:pro>`), which are handled without limitation.

**Rationale:** The `defaultNs` mechanism is a best-effort accommodation for a
specific pattern found in some extensions. Its inherent limitations (synthetic
prefix derived from element name) make it unsuitable for general use. Explicit
prefixes are always preferred.

#### 9.7.5 Summary of Rejected Patterns

The following XML namespace patterns are rejected during XML-to-JSON conversion:

| Pattern                                                          | Reason                                         |
| ---------------------------------------------------------------- | ---------------------------------------------- |
| Prefix rebinding (`xmlns:p="A"` at root, `xmlns:p="B"` on child) | Prefix ambiguity after hoisting                |
| URI aliasing (`xmlns:p1="A"` and `xmlns:p2="A"`)                 | Ambiguous prefix key for same namespace        |
| Prefix collides with DASH property name                          | Cannot distinguish extension from DASH content |
| Multiple `defaultNs` elements for same URI                       | Root `$ns` can hold only one entry per URI     |
| `defaultNs` element name collides with DASH element              | Cannot distinguish extension from DASH content |

In all cases, the remedy is straightforward: refactor the XML to use unique,
non-colliding prefixes declared on the root element.

### 9.8 Limitations

#### Element Order Between Namespaces

When an element contains children from multiple namespaces, the relative
ordering between elements from different namespaces is not preserved. Elements
from each namespace are grouped together under their prefix key.

**XML (order: A, B, C):**

```xml
<Parent>
  <ext1:A/>
  <ext2:B/>
  <ext1:C/>
</Parent>
```

**JSON (grouped by prefix):**

```json
{
  "ext1": { "A": {}, "C": {} },
  "ext2": { "B": {} }
}
```

The interleaving order between namespaces is lost. Consumers MUST NOT rely on
any property ordering within a JSON object; JSON object member ordering is not a
reliable interoperability mechanism.

#### No Schema Validation for Extension Content

Extension content is structurally permitted via `additionalProperties: true` in
the JSON Schema, but it is not validated against any namespace-specific schema.
Any valid JSON structure is accepted under prefix keys.

## 10. Document Conversion: JSON to XML

The JSON-to-XML conversion reverses the process described in Section 8,
reconstructing a valid MPD XML document from its JSON representation.

### 10.1 Root Element

The root JSON object becomes the `<MPD>` element. The DASH namespace declaration
(`xmlns="urn:mpeg:dash:schema:mpd:2011"`) is always added to the root element.

### 10.2 Namespace Reconstruction

The `$ns` property is read to reconstruct `xmlns:prefix="uri"` declarations.
These are placed on the root `<MPD>` element.

The `$ns` property is root-only. Nested `$ns` objects are invalid input.
Implementations MAY emit a warning and ignore nested `$ns` declarations.

### 10.3 Properties to Attributes and Elements

For each property on a JSON object:

1. **`$ns`**: Processed for namespace declarations, not emitted as XML content.
2. **`$value`**: Emitted as the text content of the element.
3. **Properties matching a known namespace prefix**: Processed as extension
   content (see below).
4. **Array properties**: Each array item becomes a child element occurrence.
5. **Object properties**: Become a child element.
6. **Primitive properties** (string, number, boolean): Become XML attributes on
   the element, with the value converted to its string representation.

The distinction between attributes and child elements for DASH namespace content
is determined using the MPD XSD-derived model plus practical conversion rules.
For DASH namespace content, objects/arrays are always child elements. For
primitive values, implementations typically distinguish attributes from elements
using DASH naming conventions (attributes are lower `camelCase`; elements are
`UpperCamelCase`) plus a small set of known exceptions for simple-content
elements.

Where available, implementations SHOULD prefer schema-derived metadata (for
example, JSON Schema annotations derived from the MPD XSD) over naming
conventions when deciding whether a primitive property maps to an XML attribute.

### 10.4 Extension Content Reconstruction

For properties matching a declared namespace prefix:

1. Read the `attributes` list from the `$ns` entry for this namespace.
2. For each property under the prefix key:
   - If the property name is in the `attributes` list, emit it as an XML
     attribute: `prefix:name="value"`.
   - If the value is an object or array, emit it as an XML child element:
     `<prefix:name>...</prefix:name>`.
   - If the value is a primitive and not in `attributes`, emit it as a text-only
     child element: `<prefix:name>value</prefix:name>`.
3. For well-known attribute namespaces (XLink, XSI), all primitive values
   default to attributes.

### 10.5 Type Serialization

JSON typed values are serialized back to XML strings:

- **Integers and numbers**: Converted to decimal string representation.
- **Booleans**: Converted to `"true"` or `"false"`.
- **Arrays** (for list types): Items are joined with a single space character.
- **Strings**: Used as-is.

### 10.6 Round-Trip Fidelity

A conforming implementation SHALL produce semantically equivalent XML when
performing a round-trip conversion (XML to JSON to XML). Semantic equivalence
means:

- All attributes are preserved with their correct values and types.
- All child elements are preserved with their correct content and nesting.
- All namespace-qualified extension content is preserved.
- Whitespace normalization is permitted (insignificant whitespace may differ).
- Attribute ordering may differ (XML does not define attribute order).
- Namespace declaration placement may differ (e.g., all declarations may be
  hoisted to the root).
- Comment and processing instruction nodes are not preserved.

## 11. JSON Schema Validation

The generated JSON Schema enables validation of JSON MPD documents with standard
JSON Schema validators (e.g., `ajv`). JSON Schema validation is a useful
pre-check but is not sufficient to establish conformance on its own because the
MPD XSD contains wildcard extension points (`xs:any`/`xs:anyAttribute`) and XSD
lexical constraints that may not be fully enforced by JSON Schema validators.

A valid JSON MPD document:

1. Conforms to the `MPDtype` definition in the schema.
2. Has all required properties present with correct types.
3. Has array elements where the schema specifies arrays.
4. Has `$value` properties where the schema specifies simple content.
5. May have additional properties under namespace prefix keys (permitted by
   `additionalProperties: true` on types with `xs:any`/`xs:anyAttribute`).

### 11.1 Custom Formats

The JSON Schema uses custom format keywords that validators should register:

| Format          | Description                                       | Example                |
| --------------- | ------------------------------------------------- | ---------------------- |
| `iso-duration`  | ISO 8601 duration (superset of RFC 3339 duration) | `PT30S`, `PT1.5S`      |
| `iso-date-time` | ISO 8601 date-time (timezone optional)            | `2026-01-01T00:00:00Z` |
| `iso-time`      | ISO 8601 time (timezone optional)                 | `12:00:00`             |

These formats are more permissive than JSON Schema's built-in `duration`,
`date-time`, and `time` formats, matching the XSD type definitions.

## 12. MPD Patch Documents

DASH defines an MPD Patch mechanism (ISO/IEC 23009-1, Annex K) based on RFC 5261
that allows incremental updates to MPD documents. The patch operations are
defined in the `DASH-MPD-PATCH.xsd` schema, which imports the IANA RFC 5261
patch-ops schema.

This section defines a **JSON-only patch profile** that enables patch operations
to be evaluated directly against the JSON MPD model without requiring
reconversion to XML. The profile defines a supported selector subset,
JSON-native payload rules, and clear restrictions on RFC 5261 features that
cannot be meaningfully represented in JSON. If an MPD author's patch use case
cannot be expressed within this profile, they SHOULD use the original XML MPD
format with standard RFC 5261 patching.

### 12.1 Patch Schema

The MPD Patch XSD is converted to a separate JSON Schema
(`dash-mpd-patch.schema.json`) using the same rules defined in Section 7. The
root type is `PatchType`.

#### 12.1.1 Repeating Choice Mapping

The `PatchType` in the XSD uses `xs:choice` with `maxOccurs="unbounded"`,
allowing an interleaved sequence of `add`, `remove`, and `replace` operations.
Because operation order is semantically significant in RFC 5261 (e.g., a
`remove` followed by an `add` is different from an `add` followed by a
`remove`), the JSON representation uses a single ordered `operations` array
rather than separate arrays per operation type.

When an `xs:choice` has `maxOccurs > 1` or `maxOccurs="unbounded"`, the standard
`oneOf` mapping (Section 7) does not suffice because it represents a single
selection. Instead, the choice maps to a JSON array where each item uses `oneOf`
to select among the alternatives. For the patch schema, this produces:

```
operations: array
  items: oneOf
    - { add: AddType }
    - { remove: RemoveType }
    - { replace: ReplaceType }
    - extension object (xs:any from other namespaces)
```

The extension alternative uses a `not` constraint to exclude objects containing
named operation keys, ensuring correct `oneOf` discrimination.

#### 12.1.2 XSD `xs:anyType` Restriction Handling

The `add` and `replace` types in the patch-ops schema restrict `xs:anyType` to
define their own attributes and an `xs:any` sequence with mixed content. Since
`xs:anyType` has no corresponding definition in JSON Schema, the converter
builds the schema inline from the restriction's own content model rather than
referencing a base type.

### 12.2 Execution Model

A conforming JSON MPD patch processor:

1. SHALL evaluate selectors directly against the JSON MPD object model.
2. SHALL NOT convert the JSON MPD to XML to apply patch operations.
3. SHALL NOT parse `$value` content as XML markup. The `$value` property is
   always a plain string value.
4. SHALL reject a patch document that uses selectors or operations outside the
   supported subset defined in this section.
5. SHALL apply operations in the order they appear in the `operations` array.
   After each operation, subsequent operations are evaluated against the
   modified state of the MPD.

This model avoids the cost of XML serialization and parsing, which is a primary
motivation for the JSON MPD representation. Implementations that need the full
RFC 5261 feature set SHOULD use XML MPDs with standard RFC 5261 processing.

### 12.3 Selector Evaluation

RFC 5261 selectors are XPath expressions that identify target nodes in the XML
document. In the JSON MPD model, there is no XML infoset, so selectors must be
interpreted as navigation paths through the JSON object structure.

#### 12.3.1 Supported Selector Subset

A conforming JSON MPD patch processor SHALL support the following selector
constructs:

| Construct                    | Example                   | JSON Interpretation                                     |
| ---------------------------- | ------------------------- | ------------------------------------------------------- |
| Absolute path from root      | `/MPD/Period`             | Navigate from root JSON object                          |
| Child element step           | `Period`, `AdaptationSet` | Access named property on current object                 |
| Attribute step               | `@publishTime`, `@id`     | Access named property on current object (primitive)     |
| Numeric positional predicate | `[1]`, `[2]`              | Index into JSON array (1-based to 0-based conversion)   |
| Attribute equality predicate | `[@id='p1']`              | Find array element where property matches value         |
| Value equality predicate     | `[.='value']`             | Match `$value` property of simpleContent array elements |

**Grammar (informational).** The supported selectors conform to this simplified
production (not all valid RFC 5261 XPaths are accepted):

```
selector    = "/" root-step ("/" step)* ("/" terminal)?
root-step   = "MPD"
step        = element-name predicate?
terminal    = "@" attr-name
            / element-name predicate?
element-name = QName        ; unqualified for DASH namespace, prefixed for extensions
attr-name    = NCName
predicate   = "[" digit+ "]"
            / "[@" attr-name "='" value "']"
            / "[@" attr-name '="' value '"]'
            / "[.='" value "']"
            / '[.="' value '"]'
```

#### 12.3.2 Root Element

The XPath prefix `/MPD` maps to the root JSON object. Since the JSON MPD
representation does not have a wrapping `"MPD"` property (the root object _is_
the MPD), the `/MPD` segment is consumed during selector parsing and does not
correspond to a property access. All selectors MUST begin with `/MPD`.

#### 12.3.3 Array Elements vs. Singletons

Whether a path step requires array indexing is determined by the JSON Schema
(which reflects the XSD `maxOccurs`):

- **Array elements** (`maxOccurs` > 1): `Period`, `AdaptationSet`,
  `Representation`, `BaseURL`, `S`, `SegmentURL`, `ContentProtection`, `Event`,
  `EventStream`, `Location`, `PatchLocation`, `UTCTiming`, `Subset`, `Label`,
  `ProgramInformation`, among others. A selector step targeting an array element
  without a predicate selects the **entire array** (valid only for `remove`
  operations).
- **Singleton elements** (`maxOccurs` = 1): `SegmentBase`, `SegmentTemplate`,
  `SegmentTimeline`, `SegmentList`, `Initialization`, `RepresentationIndex`,
  `BitstreamSwitching`, `AssetIdentifier`, among others. These are direct object
  properties; no positional predicate is needed or permitted.

Example path resolution for
`/MPD/Period[@id='1']/AdaptationSet[1]/SegmentTemplate/SegmentTimeline/S[3]`:

| Step                | JSON Navigation                   | Notes                      |
| ------------------- | --------------------------------- | -------------------------- |
| `/MPD`              | `mpd` (root object)               | Root consumed              |
| `/Period[@id='1']`  | `.Period.find(p => p.id === '1')` | Array + predicate          |
| `/AdaptationSet[1]` | `.AdaptationSet[0]`               | Array + position (1-based) |
| `/SegmentTemplate`  | `.SegmentTemplate`                | Singleton                  |
| `/SegmentTimeline`  | `.SegmentTimeline`                | Singleton                  |
| `/S[3]`             | `.S[2]`                           | Array + position (1-based) |

#### 12.3.4 Index Conversion

XPath positional predicates use 1-based indexing. JSON arrays use 0-based
indexing. The mapping is:

- XPath `[n]` → JSON index `[n - 1]`
- XPath `[1]` → JSON index `[0]` (first element)

If the resulting index is out of bounds, the processor SHALL reject the
operation with an error.

#### 12.3.5 Attribute Predicates and Type Coercion

XPath predicates always use string comparison. JSON MPD properties may be typed
as integers, numbers, or booleans after type coercion (Section 8.5). When
evaluating an attribute predicate, the processor SHALL coerce the predicate's
string value to the JSON type of the target property before comparison:

| JSON Type | Coercion Rule                                          | Example                               |
| --------- | ------------------------------------------------------ | ------------------------------------- |
| `integer` | Parse predicate value as integer                       | `[@id='1']` matches `id: 1`           |
| `number`  | Parse predicate value as number                        | `[@ttl='60']` matches `ttl: 60`       |
| `boolean` | `"true"` / `"1"` → `true`; `"false"` / `"0"` → `false` | `[@flag='true']` matches `flag: true` |
| `string`  | No coercion needed                                     | `[@id='p1']` matches `id: "p1"`       |

If the coercion fails (e.g., `[@id='abc']` against an integer property), no
elements match.

#### 12.3.6 Value Predicates

The value predicate `[.='value']` tests the text content of an element. In the
JSON model:

- For simpleContent elements (e.g., `BaseURL`, `Location`): the predicate
  compares against the `$value` property.
- For plain-text elements (e.g., `Title`): the predicate compares against the
  string value itself.

Value predicates are useful for selecting `BaseURL` elements by their URL
content or `Location` elements by their URI.

#### 12.3.7 Attribute Step (Terminal)

When a selector ends with `@attr-name`, it targets a specific attribute (JSON
primitive property) on the element identified by the preceding steps. This is
used for `replace` and `remove` operations on individual attributes:

- `/MPD/@publishTime` → targets `mpd.publishTime`
- `/MPD/Period[@id='1']/@duration` → targets `mpd.Period.find(...).duration`

The `@` prefix is stripped; the remainder is the JSON property name.

#### 12.3.8 Unsupported Selector Constructs

A conforming processor SHALL reject selectors that use any of the following RFC
5261 XPath constructs:

| Construct                      | Reason for exclusion                                                                                                                                 |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `text()`                       | No separate text nodes in JSON; use `$value` or direct string access. Producers SHALL use the parent element selector with `$value` payload instead. |
| `comment()`                    | JSON has no comment representation (Section 10.6).                                                                                                   |
| `processing-instruction()`     | JSON has no PI representation (Section 10.6).                                                                                                        |
| `namespace::*`                 | Namespace nodes have no JSON equivalent; `$ns` is structural metadata, not patchable content.                                                        |
| Wildcard `*`                   | Ambiguous target in JSON; each step must name a specific property.                                                                                   |
| `id()` function                | Requires document-wide ID lookup not supported by the JSON model.                                                                                    |
| Parent/ancestor/sibling axes   | Only forward child-axis navigation is supported.                                                                                                     |
| Compound predicates            | Only single predicates per step are supported.                                                                                                       |
| Arithmetic/function predicates | Only positional `[n]`, attribute `[@a='v']`, and value `[.='v']` predicates.                                                                         |

When a patch document contains an operation with an unsupported selector, the
processor SHALL reject the **entire patch document** without applying any
operations (atomic failure).

### 12.4 Patch Operations

The operations array contains `add`, `remove`, and `replace` operations. Each
item in the array is an object with exactly one property whose key identifies
the operation type.

#### 12.4.1 Payloads Are JSON, Not XML

In the XML patch model (RFC 5261), the payload of `add` and `replace` operations
is an XML fragment embedded in the operation element. **In the JSON patch model,
payloads are native JSON values.** There is no XML fragment parsing.

- **Attribute payloads**: Use `$value` with a scalar value (string, number, or
  boolean). The value is assigned to the target property after type coercion
  according to the JSON Schema type of the target property.
- **Element payloads**: Use named properties in the MPD JSON representation
  (Section 6, Section 8). The payload is a JSON object or array that conforms to
  the same JSON Schema type as the target element.
- Producers MUST NOT embed XML markup in `$value`. The `$value` property is
  always interpreted as a plain scalar.

#### 12.4.2 `add` Operation

Adds an attribute or element to the target identified by `sel`.

| Property    | Type     | Required | JSON Interpretation                                    |
| ----------- | -------- | -------- | ------------------------------------------------------ |
| `sel`       | `string` | Yes      | Selector identifying the parent or sibling target      |
| `pos`       | `string` | No       | Insertion position: `"before"`, `"after"`, `"prepend"` |
| `type`      | `string` | No       | When adding an attribute: `"@attr-name"`               |
| `value`     | scalar   | No       | Scalar value for attribute or `simpleContent` target   |
| _(element)_ | object   | No       | Element payload as MPD JSON object                     |

**Adding an attribute:**

When `type` is present and starts with `@`, the operation adds a new attribute
(primitive property) to the target element. The `$value` carries the value,
coerced to the JSON Schema type of the target property.

```json
{
  "add": {
    "sel": "/MPD",
    "type": "@mediaPresentationDuration",
    "$value": "PT3600S"
  }
}
```

Effect on JSON MPD:

```javascript
mpd.mediaPresentationDuration = 'PT3600S'
```

**Adding an element to an array (append):**

When `sel` targets a parent element and no `pos` is specified, the new element
is appended to the end of the target array. The payload property name identifies
the element type and its value is the element content in MPD JSON form.

```json
{
  "add": {
    "sel": "/MPD",
    "Period": {
      "id": "p2",
      "start": "PT60S",
      "AdaptationSet": [
        {
          "id": 1,
          "mimeType": "video/mp4",
          "Representation": [{ "id": "v1", "bandwidth": 5000000 }]
        }
      ]
    }
  }
}
```

Effect on JSON MPD:

```javascript
mpd.Period.push({ id: "p2", start: "PT60S", AdaptationSet: [...] })
```

**Adding an element at a position (before/after sibling):**

When `pos` is `"before"` or `"after"`, `sel` identifies a sibling element. The
new element is inserted before or after the sibling in the parent array. When
`pos` is `"prepend"`, `sel` identifies the parent element and the new element is
inserted at the beginning of the target array.

```json
{
  "add": {
    "sel": "/MPD/Period[1]",
    "pos": "before",
    "Period": {
      "id": "p0",
      "start": "PT0S"
    }
  }
}
```

Effect on JSON MPD:

```javascript
mpd.Period.splice(0, 0, { id: 'p0', start: 'PT0S' }) // insert before index 0
```

**Adding segment timeline entries:**

A common live streaming operation is appending new `S` entries to a
`SegmentTimeline`:

```json
{
  "add": {
    "sel": "/MPD/Period[@id='1']/AdaptationSet[@id='1']/SegmentTemplate/SegmentTimeline",
    "S": { "t": 5495019529, "d": 360360 }
  }
}
```

Effect on JSON MPD:

```javascript
// ... .SegmentTimeline.S.push({ t: 5495019529, d: 360360 })
```

Note that `S` is an array element. When the payload value is a single object
(not an array), it is appended as one element. When the payload value is an
array, all items are appended.

#### 12.4.3 `replace` Operation

Replaces an attribute value or element identified by `sel`.

| Property    | Type     | Required | JSON Interpretation                              |
| ----------- | -------- | -------- | ------------------------------------------------ |
| `sel`       | `string` | Yes      | Selector identifying the target to replace       |
| `$value`    | scalar   | No       | Replacement scalar value (for attributes / text) |
| _(element)_ | object   | No       | Replacement element as MPD JSON object           |

**Replacing an attribute value:**

When `sel` ends with `@attr-name`, the attribute's value is replaced. The new
value in `$value` is coerced to the JSON Schema type.

```json
{ "replace": { "sel": "/MPD/@publishTime", "$value": "2026-01-15T12:01:00Z" } }
```

Effect on JSON MPD:

```javascript
mpd.publishTime = '2026-01-15T12:01:00Z'
```

**Replacing a `$value` (simpleContent text):**

For simpleContent elements like `BaseURL`, `Location`, and `PatchLocation`, the
`sel` targets the element and `$value` provides the replacement text content.

```json
{
  "replace": {
    "sel": "/MPD/PatchLocation[1]",
    "$value": "patch.mpp?t=2026-01-15T12:01:00Z"
  }
}
```

Effect on JSON MPD:

```javascript
mpd.PatchLocation[0].$value = 'patch.mpp?t=2026-01-15T12:01:00Z'
```

Note: This replaces only the text content, preserving sibling attributes (`ttl`,
`serviceLocation`, etc.). If the intent is to replace the entire element
including attributes, an element payload should be used instead.

**Replacing an attribute on a deeply nested element:**

```json
{
  "replace": {
    "sel": "/MPD/Period[@id='1']/AdaptationSet[@id='1']/SegmentTemplate/SegmentTimeline/S[1]/@r",
    "$value": 9
  }
}
```

Effect on JSON MPD:

```javascript
// ... .SegmentTimeline.S[0].r = 9
```

Note: `$value` is `9` (integer), not `"9"` (string). In the JSON patch model,
producers SHOULD use the native JSON type matching the schema. Processors SHOULD
also accept string values and coerce them according to Section 12.3.5 rules.

**Replacing an entire element:**

When `sel` targets an element (not an attribute), the payload is a replacement
JSON object conforming to the element's schema type.

```json
{
  "replace": {
    "sel": "/MPD/Period[@id='1']/AdaptationSet[@id='1']/SegmentTemplate",
    "SegmentTemplate": {
      "timescale": 90000,
      "media": "seg-$Number$.m4s",
      "initialization": "init.m4s",
      "startNumber": 1
    }
  }
}
```

Effect on JSON MPD:

```javascript
// ... .SegmentTemplate = { timescale: 90000, media: "seg-$Number$.m4s", ... }
```

#### 12.4.4 `remove` Operation

Removes an attribute or element identified by `sel`.

| Property | Type     | Required | JSON Interpretation                       |
| -------- | -------- | -------- | ----------------------------------------- |
| `sel`    | `string` | Yes      | Selector identifying the target to remove |
| `ws`     | `string` | No       | Ignored in JSON model (see below)         |

**Removing an attribute:**

```json
{ "remove": { "sel": "/MPD/@minimumUpdatePeriod" } }
```

Effect on JSON MPD:

```javascript
delete mpd.minimumUpdatePeriod
```

**Removing an array element:**

```json
{ "remove": { "sel": "/MPD/Period[@id='old']" } }
```

Effect on JSON MPD:

```javascript
mpd.Period = mpd.Period.filter((p) => p.id !== 'old')
```

**Removing segment timeline entries (sliding window):**

```json
{
  "remove": {
    "sel": "/MPD/Period[@id='1']/AdaptationSet[@id='1']/SegmentTemplate/SegmentTimeline/S[1]"
  }
}
```

Effect on JSON MPD:

```javascript
// ... .SegmentTimeline.S.splice(0, 1)  // remove first (oldest) entry
```

**Removing a singleton element:**

```json
{
  "remove": { "sel": "/MPD/Period[@id='1']/AdaptationSet[@id='1']/SegmentBase" }
}
```

Effect on JSON MPD:

```javascript
delete mpd.Period.find(...).AdaptationSet.find(...).SegmentBase
```

**The `ws` attribute.** RFC 5261 defines `ws` for controlling whitespace cleanup
around removed XML nodes. Since the JSON model has no insignificant whitespace,
the `ws` attribute SHALL be accepted for compatibility but SHALL have no effect
on the JSON operation. Processors MUST NOT reject a patch that includes `ws`.

### 12.5 Payload Type Coercion

When a `$value` payload sets an attribute or text content, the value SHALL be
coerced to the JSON Schema type of the target property:

| Target Schema Type | Coercion Rule                                                     | Example                     |
| ------------------ | ----------------------------------------------------------------- | --------------------------- |
| `string`           | Use value as-is (or convert to string)                            | `"PT30S"` remains `"PT30S"` |
| `integer`          | Parse as integer; reject if not integral                          | `9` or `"9"` → `9`          |
| `number`           | Parse as number                                                   | `5.0` or `"5.0"` → `5.0`    |
| `boolean`          | `true`/`"true"`/`"1"` → `true`; `false`/`"false"`/`"0"` → `false` | `"true"` → `true`           |

If a `$value` payload targets a `simpleContent` element (e.g., `BaseURL`,
`PatchLocation`), the value is assigned to the `$value` property of the target
object, not to the object itself. The processor identifies `simpleContent`
targets by consulting the JSON Schema: if the target element's schema defines a
`$value` property, the replacement is applied to `$value`.

When an element payload (JSON object) is used for `add` or `replace`, no
coercion is needed — the object is used as-is and SHALL conform to the JSON
Schema for that element type.

### 12.6 Unsupported RFC 5261 Features

The following RFC 5261 capabilities are not supported in the JSON-only patch
profile. A conforming processor SHALL reject patch documents that require these
features.

| Feature                      | Reason                                                                                                   |
| ---------------------------- | -------------------------------------------------------------------------------------------------------- |
| XML fragment payloads        | Payloads MUST be native JSON. `$value` is never parsed as XML.                                           |
| `text()` selectors           | No separate text nodes in JSON. Use the parent element selector with `$value` payload.                   |
| `comment()` selectors        | Comments are not preserved in JSON (Section 10.6).                                                       |
| `processing-instruction()`   | PIs are not preserved in JSON (Section 10.6).                                                            |
| `namespace::*` selectors     | Namespace nodes have no JSON equivalent. `$ns` is root-level structural metadata, not patchable content. |
| `id()` function              | Document-wide ID lookup is not supported.                                                                |
| Wildcard `*` steps           | Ambiguous target; each path step must name a specific property.                                          |
| Multiple predicates per step | Only one predicate per step is supported.                                                                |

### 12.7 Complete Example: Live Stream Patch

The following patch updates a live MPD by advancing the publish time, updating
the patch location, appending a new segment timeline entry, removing the oldest
entry, and adding a new `Period`:

```json
{
  "mpdId": "live-stream-001",
  "publishTime": "2026-01-15T12:01:00Z",
  "originalPublishTime": "2026-01-15T12:00:00Z",
  "operations": [
    {
      "replace": {
        "sel": "/MPD/@publishTime",
        "$value": "2026-01-15T12:01:00Z"
      }
    },
    {
      "replace": {
        "sel": "/MPD/PatchLocation[1]",
        "$value": "patch.mpp?t=2026-01-15T12%3A01%3A00Z"
      }
    },
    {
      "remove": {
        "sel": "/MPD/Period[@id='1']/AdaptationSet[@id='1']/SegmentTemplate/SegmentTimeline/S[1]"
      }
    },
    {
      "add": {
        "sel": "/MPD/Period[@id='1']/AdaptationSet[@id='1']/SegmentTemplate/SegmentTimeline",
        "S": { "t": 5495019529, "d": 360360 }
      }
    },
    {
      "replace": {
        "sel": "/MPD/@type",
        "$value": "dynamic"
      }
    },
    {
      "add": {
        "sel": "/MPD",
        "type": "@availabilityEndTime",
        "$value": "2026-01-15T13:00:00Z"
      }
    },
    {
      "add": {
        "sel": "/MPD",
        "Period": {
          "id": "p2",
          "start": "PT3600S",
          "AdaptationSet": [
            {
              "id": 1,
              "mimeType": "video/mp4",
              "Representation": [{ "id": "v1", "bandwidth": 5000000 }]
            }
          ]
        }
      }
    }
  ]
}
```

### 12.8 PatchLocation in MPD

The MPD schema defines a `PatchLocationType` element that provides a URI to the
patch document. When the MPD is represented in JSON, the `PatchLocation.$value`
URI SHOULD resolve to a JSON document conforming to the
`dash-mpd-patch.schema.json` schema.

## 13. Remote Element Loading (XLink)

DASH defines a remote element loading mechanism based on W3C XLink (XML Linking
Language) that allows elements in the MPD to be fetched from external URLs at
parse time or on demand. In the XML representation, this is expressed through
`xlink:href` and `xlink:actuate` attributes on elements such as `Period`,
`AdaptationSet`, `EventStream`, `SegmentList`, and `InitializationSet`.

In the JSON representation, XLink is treated as a regular extension namespace
following the rules in Section 9. The XLink attributes (`href`, `actuate`) are
grouped under an `"xlink"` prefix key on the element, and the XLink namespace
URI is declared in the root `$ns` property. This is consistent with the
converter's treatment of all namespace-qualified attributes and avoids
introducing special-case handling for what is, structurally, just another
attribute namespace.

What _does_ change for the JSON ecosystem is the resolution process itself: when
a client resolves a remote element reference, the remote resource returns
**JSON** (not XML), and the merge back into the MPD operates on the JSON object
model. This section specifies how clients perform that resolution and merge.

### 13.1 Which Elements Support Remote Loading

Which elements support XLink is determined by the MPD XSD: any complex type that
declares `xlink:href` as an attribute supports remote loading. In the JSON
representation this is surfaced naturally - those element types will have an
`"xlink"` property in the converted output because the converter follows the
standard namespace grouping rules (Section 9.3, 9.5). The JSON Schema itself
does not restrict the `"xlink"` key, since XLink attributes pass through as
extension content via `additionalProperties: true`.

In the current edition of the MPD XSD (ISO/IEC 23009-1, 6th edition), the
element types that declare XLink attributes are `Period`, `EventStream`,
`InitializationSet`, `AdaptationSet`, and `SegmentList`. The URL Parameters
extension schema (`DASH-MPD-UP.xsd`) additionally declares XLink on
`UrlQueryInfo`. Future editions of the standard may add XLink support to
additional elements; no change to this specification is required when that
happens, since the `"xlink"` property is handled as general extension content.

### 13.2 JSON Representation of XLink Attributes

An element that should be resolved from a remote URL carries an `"xlink"`
property containing the XLink attributes, following the standard namespace
grouping rules (Section 9.3, 9.5). The relevant attributes are:

| XLink Attribute | JSON Property   | Required | Description                                          |
| --------------- | --------------- | -------- | ---------------------------------------------------- |
| `xlink:href`    | `xlink.href`    | Yes      | The URL to fetch the remote element content from     |
| `xlink:actuate` | `xlink.actuate` | No       | `"onLoad"` or `"onRequest"` (default: `"onRequest"`) |
| `xlink:type`    | _(omitted)_     | No       | Always `"simple"` in DASH; may be omitted            |
| `xlink:show`    | _(omitted)_     | No       | Always `"embed"` in DASH; may be omitted             |

The `xlink:type` and `xlink:show` attributes are fixed values in the DASH XSD
(`"simple"` and `"embed"` respectively). They carry no information and MAY be
omitted from the JSON representation. If present, they SHALL have their fixed
values. A conforming JSON-to-XML converter SHALL reconstruct these fixed values
when converting back to XML regardless of whether they appear in the JSON.

The XLink namespace MUST be declared in the root `$ns` property whenever any
element carries an `"xlink"` property:

```json
{
  "$ns": {
    "http://www.w3.org/1999/xlink": "xlink"
  }
}
```

**Example: Period with remote loading**

```json
{
  "$ns": {
    "http://www.w3.org/1999/xlink": "xlink"
  },
  "type": "static",
  "minBufferTime": "PT2S",
  "mediaPresentationDuration": "PT60S",
  "Period": [
    {
      "xlink": {
        "href": "https://example.com/periods/period_0.json",
        "actuate": "onLoad"
      }
    }
  ]
}
```

**Example: Period stub with local attributes and remote loading**

An element MAY carry local attributes alongside `"xlink"`. These serve as hints
or defaults that the client can use before or during resolution (e.g., `id` and
`start` on a Period allow the client to construct the timeline before the remote
content is available):

```json
{
  "$ns": {
    "http://www.w3.org/1999/xlink": "xlink"
  },
  "Period": [
    {
      "id": "ad-break",
      "start": "PT300S",
      "xlink": {
        "href": "https://ads.example.com/period.json",
        "actuate": "onRequest"
      }
    }
  ]
}
```

**Example: Multiple Periods with mixed inline and remote content**

```json
{
  "$ns": {
    "http://www.w3.org/1999/xlink": "xlink"
  },
  "Period": [
    {
      "id": "0",
      "duration": "PT250S",
      "AdaptationSet": [{ "id": 1, "mimeType": "video/mp4" }]
    },
    {
      "xlink": {
        "href": "https://example.com/remote-period.json",
        "actuate": "onRequest"
      }
    },
    {
      "id": "2",
      "duration": "PT344S",
      "AdaptationSet": [{ "id": 1, "mimeType": "video/mp4" }]
    }
  ]
}
```

### 13.3 Actuate Modes

The `xlink.actuate` property controls **when** the remote resource is fetched:

#### 13.3.1 `onLoad`

The client SHALL resolve the remote reference immediately when the MPD is
parsed. The element is a placeholder until resolution completes. The MPD is not
considered fully loaded until all `onLoad` links have been resolved (or have
failed).

**Use case:** Eagerly loading period definitions that are needed immediately,
such as the first period of a presentation.

#### 13.3.2 `onRequest` (Default)

The client SHALL resolve the remote reference only when the element's content is
actually needed - for example, when playback approaches a Period's start time,
or when the user selects an `AdaptationSet`.

**Use case:** Lazy loading of future periods in live streams, ad break content,
or alternative adaptation sets that may never be selected.

When `actuate` is absent, `"onRequest"` is the default, matching the XML XSD
default.

### 13.4 Remote Resource Format

The resource at `xlink.href` SHALL return a JSON document. The response content
type SHOULD be `application/json`.

#### 13.4.1 Response Structure

The response SHALL be a JSON object conforming to the JSON Schema type of the
element being resolved. The response represents the **complete replacement
content** for the stub element.

**For array elements** (`Period`, `AdaptationSet`, `EventStream`,
`InitializationSet`): the response MAY be either a single JSON object or a JSON
array of objects. When the response is an array, the stub element is replaced by
all elements in the array (expanding the parent array). When the response is a
single object, it replaces the stub as a single element.

**For singleton elements** (`SegmentList`): the response SHALL be a single JSON
object.

**Example: Remote Period response (single object)**

Request: `GET https://example.com/periods/period_0.json`

Response:

```json
{
  "id": "0",
  "duration": "PT250S",
  "AdaptationSet": [
    {
      "id": 1,
      "mimeType": "video/mp4",
      "codecs": "avc1.4d401f",
      "Representation": [
        {
          "id": "v1",
          "bandwidth": 980104,
          "SegmentTemplate": {
            "timescale": 12288,
            "duration": 24576,
            "media": "video_$Number$.m4s",
            "initialization": "video_init.m4s"
          }
        }
      ]
    }
  ]
}
```

**Example: Remote Period response (array, one-to-many expansion)**

A single stub can resolve to multiple elements. This is useful for server-side
ad insertion where an ad break Period resolves to multiple ad Periods:

Request: `GET https://ads.example.com/period.json`

Response:

```json
[
  {
    "id": "ad-1",
    "duration": "PT15S",
    "AdaptationSet": [{ "id": 1, "mimeType": "video/mp4" }]
  },
  {
    "id": "ad-2",
    "duration": "PT30S",
    "AdaptationSet": [{ "id": 1, "mimeType": "video/mp4" }]
  }
]
```

#### 13.4.2 Base URL Resolution

Relative URLs within the resolved content (e.g., in `BaseURL`, `SegmentTemplate`
media/initialization attributes) SHALL be resolved relative to the `xlink.href`
URL, following the same base URL resolution rules that DASH defines for XML
XLink (ISO/IEC 23009-1, 5.6.5). This ensures that the remote resource can
reference media segments using paths relative to its own location.

### 13.5 Merge Semantics

Resolution of a remote element reference follows **replacement semantics**,
consistent with the XML XLink `show="embed"` behavior that DASH mandates.

#### 13.5.1 Resolution Algorithm

When a remote element reference is resolved, the client SHALL apply the
following algorithm:

1. Fetch the resource at `xlink.href`.
2. Parse the response as JSON.
3. Validate the response against the JSON Schema type for the element.
4. Merge local attributes from the stub into the resolved content (see 13.5.2).
5. Replace the stub element with the resolved content in the parent container.
6. Remove the `xlink` property from the resolved element(s). After resolution,
   the element is treated as if the content had been inline all along.

For array elements where the response is an array, step 5 replaces the single
stub element with the multiple resolved elements at the same position in the
parent array.

#### 13.5.2 Local Attribute Preservation

A stub element MAY carry local attributes alongside the `xlink` property (e.g.,
`id`, `start`, `duration` on a Period). These serve as defaults. The merge rule
is:

- Properties present in the **resolved content** take precedence.
- Properties present on the **stub** but absent from the resolved content are
  preserved on the resolved element.
- The `xlink` property itself is always removed after resolution.

**Example:**

Stub:

```json
{
  "id": "p1",
  "start": "PT300S",
  "xlink": { "href": "https://example.com/period.json" }
}
```

Response:

```json
{
  "duration": "PT60S",
  "AdaptationSet": [{ "id": 1, "mimeType": "video/mp4" }]
}
```

Resolved element:

```json
{
  "id": "p1",
  "start": "PT300S",
  "duration": "PT60S",
  "AdaptationSet": [{ "id": 1, "mimeType": "video/mp4" }]
}
```

The `id` and `start` from the stub are preserved because the response did not
include them. The `xlink` property is removed.

When the response is an array (one-to-many expansion), local attributes from the
stub are merged into the **first** element of the response array only. This
matches the XML behavior where attributes on the stub element apply to the first
resolved element.

### 13.6 Resolve-to-Zero

DASH defines a special sentinel URI that indicates an element should be removed
entirely:

```
urn:mpeg:dash:resolve-to-zero:2013
```

When `xlink.href` equals this sentinel URI, the client SHALL remove the stub
element from its parent container without making any HTTP request. For array
elements, the element is removed from the array. For singleton elements, the
property is deleted from the parent object.

**Example:**

```json
{
  "$ns": {
    "http://www.w3.org/1999/xlink": "xlink"
  },
  "Period": [
    {
      "id": "p0",
      "duration": "PT120S",
      "AdaptationSet": [{ "id": 1, "mimeType": "video/mp4" }]
    },
    {
      "xlink": { "href": "urn:mpeg:dash:resolve-to-zero:2013" }
    },
    {
      "id": "p2",
      "duration": "PT300S",
      "AdaptationSet": [{ "id": 1, "mimeType": "video/mp4" }]
    }
  ]
}
```

After resolution, the second Period is removed. The `Period` array contains only
the first and third elements. This mechanism is used to conditionally exclude
content - for example, removing an ad break Period when no ad is available.

### 13.7 Interaction with MPD Updates

For dynamic (live) MPDs, the client periodically refreshes the MPD according to
`minimumUpdatePeriod`. Remote element resolution interacts with MPD updates as
follows.

#### 13.7.1 Full MPD Refresh

When the client fetches a new MPD (either through `minimumUpdatePeriod` polling
or by following a `Location` URL), the **entire MPD is replaced**. Any
previously resolved remote element content is discarded. If the refreshed MPD
still contains elements with `xlink` properties, they must be resolved again
according to their `actuate` mode:

- **`onLoad` elements** in the refreshed MPD are resolved immediately, just as
  on initial load.
- **`onRequest` elements** in the refreshed MPD are resolved on demand when
  needed.

The client SHALL NOT carry forward previously resolved content from a prior MPD
instance. The remote resource may have changed between updates (e.g., a new ad
break, updated segment information), and stale resolved content would cause
incorrect playback behavior.

#### 13.7.2 MPD Patch Updates

When the client applies an MPD Patch (Section 12) instead of a full MPD refresh:

- **Already-resolved elements** that are not modified by the patch retain their
  resolved content. The patch operates on the post-resolution MPD state.
- **Patch operations that add new elements with `xlink` properties** introduce
  new stubs that must be resolved according to their `actuate` mode.
- **Patch operations that modify an element's `xlink` property** (e.g., changing
  the `href`) invalidate any previously resolved content. The element reverts to
  stub state and must be re-resolved.
- **Patch operations that remove `xlink`** from an element (replacing the stub
  with inline content) do not require resolution.

Patches are designed to be applied to the **resolved** MPD - that is, the MPD as
it exists in the client's working memory after all applicable remote element
resolutions have been performed. Patch selectors navigate the resolved document
structure, not the pre-resolution stubs.

#### 13.7.3 Caching Considerations

Clients SHOULD respect standard HTTP caching headers (`Cache-Control`,
`Expires`, `ETag`, `Last-Modified`) on remote element responses. However:

- Within a single MPD lifetime, clients MAY cache and reuse resolved content for
  `onRequest` elements that have already been resolved, provided the HTTP cache
  headers permit it.
- Servers SHOULD set appropriate cache lifetimes on remote element resources.
  For live streams with rapidly changing content, short cache lifetimes or
  `no-cache` directives are appropriate.

### 13.8 Error Handling

#### 13.8.1 Resolution Failure

If the HTTP request to `xlink.href` fails (network error, non-2xx status code,
invalid JSON, schema validation failure), the client SHALL treat the element as
if it resolved to zero - the stub element is removed from the MPD. This matches
the DASH specification's error handling for XML XLink resolution failures.

#### 13.8.2 Content Type Mismatch

If the response is not valid JSON or does not conform to the expected schema
type, the client SHALL treat the resolution as failed (13.8.1).

#### 13.8.3 Circular References

A resolved element SHALL NOT itself contain an `xlink` property that directly or
indirectly references the original `xlink.href` URL. Clients SHOULD implement a
maximum resolution depth or URL tracking mechanism to detect and break circular
reference chains. A circular reference SHALL be treated as a resolution failure.

### 13.9 Complete Example: Multi-Period Live Stream with Remote Loading

The following example shows a live MPD with a mix of inline and remote Periods,
demonstrating `onLoad`, `onRequest`, and resolve-to-zero:

```json
{
  "$ns": {
    "http://www.w3.org/1999/xlink": "xlink"
  },
  "type": "dynamic",
  "availabilityStartTime": "2026-01-15T10:00:00Z",
  "minimumUpdatePeriod": "PT30S",
  "minBufferTime": "PT2S",
  "Period": [
    {
      "id": "main-content",
      "start": "PT0S",
      "AdaptationSet": [
        {
          "id": 1,
          "mimeType": "video/mp4",
          "Representation": [
            {
              "id": "v1",
              "bandwidth": 5000000,
              "SegmentTemplate": {
                "timescale": 90000,
                "media": "seg-$Number$.m4s",
                "initialization": "init.m4s"
              }
            }
          ]
        }
      ]
    },
    {
      "id": "ad-break-1",
      "start": "PT600S",
      "xlink": {
        "href": "https://ads.example.com/break1.json",
        "actuate": "onRequest"
      }
    },
    {
      "id": "resume",
      "start": "PT660S",
      "xlink": {
        "href": "https://example.com/resume-period.json",
        "actuate": "onLoad"
      }
    },
    {
      "xlink": {
        "href": "urn:mpeg:dash:resolve-to-zero:2013"
      }
    }
  ]
}
```

In this example:

- The first Period is inline with full content.
- The second Period (`ad-break-1`) uses `onRequest` - it will be resolved when
  playback approaches `PT600S`. The response may return one or more ad Periods.
- The third Period (`resume`) uses `onLoad` - it is resolved immediately on MPD
  parse. The client waits for this resolution before considering the MPD ready.
- The fourth Period uses resolve-to-zero and is removed during parsing. It may
  have been present in a prior MPD version and is now conditionally excluded.

After a full MPD refresh, all remote element stubs are re-evaluated. The ad
server may return different ad content; the resume period URL may point to
updated segment information.

## 14. Conformance

### 14.1 Conforming JSON MPD Document

A JSON document is a conforming JSON MPD if:

1. When converted to XML according to this specification, the resulting XML MPD
   validates against the MPD XSD (`xml-schemas/DASH-MPD.xsd`, including its
   imports/includes).
2. It validates against the DASH MPD JSON Schema generated according to
   Section 7.
3. Extension content (under namespace prefix keys) is properly declared in
   `$ns`.
4. The `$value` property is used for text content in simple content types.
5. Remote element loading stubs use the `xlink` property with at least an `href`
   field, and the XLink namespace is declared in `$ns` (Section 13.2).

### 14.2 Conforming XML-to-JSON Converter

A conforming XML-to-JSON converter:

1. Produces JSON output that validates against the DASH MPD JSON Schema.
2. Coerces types according to the MPD XSD type definitions (Section 8.5).
3. Represents repeated elements as arrays and singleton elements as objects.
4. Uses `$value` for simple content elements.
5. Collects namespace declarations into a root-level `$ns` (Section 9.2).
6. Groups extension content under namespace prefix keys (Section 9.3).
7. Validates namespace declarations against the constraints in Section 9.7 and
   rejects documents that violate them with a descriptive error message.
8. Maps `xlink:href` and `xlink:actuate` attributes to the `xlink` prefix key
   following the standard namespace grouping rules (Section 9.5, Section 13.2).
   The fixed-value attributes `xlink:type` and `xlink:show` MAY be omitted from
   the JSON output.

### 14.3 Conforming JSON-to-XML Converter

A conforming JSON-to-XML converter:

1. Produces XML output that validates against the MPD XSD.
2. Reconstructs namespace declarations from `$ns`.
3. Correctly distinguishes extension attributes from elements using the
   `attributes` list.
4. Serializes JSON typed values back to XML strings.
5. Produces output that is semantically equivalent to the original XML when
   performing a round-trip conversion.
6. Reconstructs XLink attributes from the `xlink` prefix key following the
   general attribute namespace rules (Section 9.5). When the fixed-value
   attributes `xlink:type` and `xlink:show` were omitted from the JSON, the
   converter SHOULD reconstruct them with their XSD-defined fixed values to
   produce XSD-valid output.

### 14.4 Conforming JSON MPD Patch Document

A JSON document is a conforming JSON MPD Patch document if:

1. It validates against the DASH MPD Patch JSON Schema
   (`dash-mpd-patch.schema.json`).
2. All `sel` values use only the supported selector subset (Section 12.3.1).
3. All payloads are native JSON values; no XML markup is embedded in `$value` or
   any other property (Section 12.4.1).
4. Element payloads conform to the JSON Schema type of the target element.
5. Scalar `$value` payloads are coercible to the JSON Schema type of the target
   property (Section 12.5).

### 14.5 Conforming JSON MPD Client (Remote Element Loading)

A conforming JSON MPD client that supports remote element loading:

1. Recognizes the `xlink` property (with `href` and optional `actuate`) on
   elements whose XSD type declares XLink attributes (Section 13.1).
2. Resolves `onLoad` elements immediately upon parsing the MPD. The MPD is not
   considered fully loaded until all `onLoad` resolutions complete or fail
   (Section 13.3.1).
3. Resolves `onRequest` elements only when the element content is needed
   (Section 13.3.2).
4. Expects JSON responses from `xlink.href` URLs, conforming to the JSON Schema
   type of the target element (Section 13.4).
5. Applies replacement semantics with local attribute preservation (Section
   13.5).
6. Handles the `urn:mpeg:dash:resolve-to-zero:2013` sentinel by removing the
   stub element without an HTTP request (Section 13.6).
7. Discards previously resolved content on full MPD refresh and re-resolves
   elements in the new MPD (Section 13.7.1).
8. Treats resolution failures (network errors, invalid JSON, schema violations)
   as resolve-to-zero (Section 13.8.1).
9. Detects and breaks circular reference chains (Section 13.8.3).

### 14.6 Conforming JSON MPD Patch Processor

A conforming JSON MPD patch processor:

1. Evaluates selectors directly against the JSON MPD object model without
   converting to XML (Section 12.2).
2. Supports the selector subset defined in Section 12.3.1, including positional
   predicates with 1-based to 0-based index conversion (Section 12.3.4) and
   type-coerced attribute predicates (Section 12.3.5).
3. Rejects the entire patch document without applying any operations if any
   operation uses an unsupported selector construct (Section 12.3.8) or an
   unsupported RFC 5261 feature (Section 12.6).
4. Applies operations in array order. Each operation is evaluated against the
   state of the MPD as modified by all preceding operations (Section 12.2).
5. Coerces `$value` payloads to the JSON Schema type of the target property
   (Section 12.5).
6. Accepts the `ws` attribute on `remove` operations without effect (Section
   12.4.4).
7. After successful application of all operations, the resulting JSON MPD SHALL
   be a conforming JSON MPD document (Section 14.1).

---

**Annex A: Summary of Reserved Property Names**

| Property | Purpose                                 | Section    |
| -------- | --------------------------------------- | ---------- |
| `$value` | Text content of simple content elements | 6.1.5, 8.4 |
| `$ns`    | Namespace declarations                  | 9.2        |

Both use the `$` prefix to avoid collision with XML attribute and element names,
which cannot start with `$` in the XSD.

**Annex B: Summary of JSON Schema Extension Keywords**

| Keyword               | Purpose                                                        |
| --------------------- | -------------------------------------------------------------- |
| `x-xml-any`           | Marks types that permit `xs:any` extension elements            |
| `x-xml-any-attribute` | Marks types that permit `xs:anyAttribute` extension attributes |

These keywords are informational markers in the JSON Schema. They are not part
of the JSON Schema vocabulary but indicate to tooling which types support
extension content.
