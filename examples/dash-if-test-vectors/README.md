# DASH-IF Test Vectors

This directory contains DASH-IF test vector MPD files downloaded from the
DASH-IF test vectors catalog.

## Scripts

### `download_mpd.py`

Downloads MPD files from the DASH-IF test vectors CSV catalog into
`downloaded_mpds/`.

### `fix_element_order.py`

Fixes element ordering in downloaded MPD files to comply with the DASH-MPD XSD
schema (`DASH-MPD.xsd`).

**Why this is needed:** The XSD uses `xs:sequence` which requires child elements
to appear in a specific order. Some real-world MPDs have elements in the wrong
order (e.g. `<Reporting>` before `<Range>` inside `<Metrics>`), which makes
them technically non-compliant with the schema even though players accept them.

The script:
- Detects which elements have children in the wrong order
- Reorders only those children, preserving all content, attributes, comments,
  and formatting
- Generates a report (`reorder_report.txt`) listing which files were modified
  and what was reordered

Usage:

```bash
# Preview what would be changed (no files modified)
python fix_element_order.py --dry-run --verbose

# Apply fixes
python fix_element_order.py --verbose

# Fix files in a custom directory
python fix_element_order.py --verbose path/to/mpds
```

The element order definitions are derived from the DASH-MPD XSD (6th Ed.) and
cover all complex types that use `xs:sequence`, including inherited sequences
from base types.

## Reports

- `download_success_report.txt` - Files successfully downloaded
- `download_failure_report.txt` - Files that failed to download
- `download_modified_report.txt` - Files modified during download
- `reorder_report.txt` - Files reordered by `fix_element_order.py`

## Known Issues

Some downloaded MPDs have issues that are NOT element-ordering problems and
cannot be fixed by the reordering script:

- **Invalid XML** - A few files are not valid XML at all (e.g. the server
  returned an error page instead of an MPD). These appear as "XML parse error"
  in the reorder report.
- **Schema type violations** - Some files use attribute values that don't match
  the XSD types (e.g. a float value where `xs:unsignedLong` is expected).
