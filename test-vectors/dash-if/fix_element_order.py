#!/usr/bin/env python3
"""
Fix element ordering in DASH MPD files to comply with the XSD schema.

The DASH-MPD XSD uses xs:sequence which requires child elements to appear in a
specific order. Some real-world MPD files (e.g. from DASH-IF test vectors) have
elements in the wrong order, which makes them technically non-compliant.

This script reorders child elements to match the XSD-defined sequence order
WITHOUT changing any content, attributes, comments, or formatting. Only the
order of sibling elements within a parent is changed.

Usage:
    python fix_element_order.py [--dry-run] [--verbose] [directory]

Arguments:
    directory       Directory containing .mpd files (default: downloaded_mpds)

Options:
    --dry-run       Report what would be changed without modifying files
    --verbose       Show details for each file processed
    -h, --help      Show this help message
"""

import argparse
import re
import sys
from datetime import datetime
from pathlib import Path
from xml.etree import ElementTree as ET

# ── XSD element ordering ─────────────────────────────────────────────────────
#
# These maps define the correct child element order for each parent element
# as specified in DASH-MPD.xsd (6th Ed.). The order is derived from
# xs:sequence definitions, including inherited sequences from base types
# (via xs:complexContent/xs:extension).
#
# Key: parent element local name
# Value: list of child element local names in correct order
#
# Elements from other namespaces (xs:any) are placed at the end.

DASH_NS = "urn:mpeg:dash:schema:mpd:2011"

# RepresentationBaseType sequence (base for AdaptationSet, Representation, etc.)
_REPRESENTATION_BASE_CHILDREN = [
    "FramePacking",
    "AudioChannelConfiguration",
    "ContentProtection",
    "OutputProtection",
    "EssentialProperty",
    "SupplementalProperty",
    "InbandEventStream",
    "Switching",
    "RandomAccess",
    "GroupLabel",
    "Label",
    "ProducerReferenceTime",
    "ContentPopularityRate",
    "Resync",
    "SegmentSequenceProperties",
]

# SegmentBaseType sequence
_SEGMENT_BASE_CHILDREN = [
    "Initialization",
    "RepresentationIndex",
    "FailoverContent",
]

# MultipleSegmentBaseType = SegmentBaseType + extension
_MULTIPLE_SEGMENT_BASE_CHILDREN = _SEGMENT_BASE_CHILDREN + [
    "SegmentTimeline",
    "BitstreamSwitching",
]

# Element ordering maps keyed by local element name
ELEMENT_ORDER = {
    "MPD": [
        "ProgramInformation", "BaseURL", "Location", "PatchLocation",
        "RequestParam", "ServiceDescription", "InitializationSet",
        "InitializationGroup", "InitializationPresentation",
        "ContentProtection", "Period", "Metrics", "EssentialProperty",
        "SupplementalProperty", "UTCTiming", "LeapSecondInformation",
    ],
    "Period": [
        "ImportedMPD", "BaseURL", "RequestParam", "SegmentBase",
        "SegmentList", "SegmentTemplate", "AssetIdentifier", "EventStream",
        "ServiceDescription", "ContentProtection", "AdaptationSet", "Subset",
        "SupplementalProperty", "EmptyAdaptationSet", "GroupLabel",
        "Preselection",
    ],
    "EventStream": [
        "Event", "BaseURL", "RequestParam", "EssentialProperty",
        "SupplementalProperty",
    ],
    "Event": [
        "SelectionInfo", "ServiceDescription", "InsertPresentation",
        "ReplacePresentation", "SupplementalProperty", "EssentialProperty",
    ],
    "SelectionInfo": ["Selection"],
    "ServiceDescription": [
        "Scope", "Latency", "PlaybackRate", "OperatingQuality",
        "OperatingBandwidth", "ContentSteering", "ClientDataReporting",
        "PlaybackRestrictions",
    ],
    "Latency": ["QualityLatency"],
    "AdaptationSet": _REPRESENTATION_BASE_CHILDREN + [
        "Accessibility", "Role", "Rating", "Viewpoint", "ContentComponent",
        "BaseURL", "RequestParam", "SegmentBase", "SegmentList",
        "SegmentTemplate", "Representation",
    ],
    "ContentComponent": ["Accessibility", "Role", "Rating", "Viewpoint"],
    "Representation": _REPRESENTATION_BASE_CHILDREN + [
        "BaseURL", "ExtendedBandwidth", "SubRepresentation", "RequestParam",
        "SegmentBase", "SegmentList", "SegmentTemplate",
    ],
    "SubRepresentation": _REPRESENTATION_BASE_CHILDREN,
    "InitializationSet": _REPRESENTATION_BASE_CHILDREN + [
        "Accessibility", "Role", "Rating", "Viewpoint",
    ],
    "Preselection": _REPRESENTATION_BASE_CHILDREN + [
        "Accessibility", "Role", "Rating", "Viewpoint",
    ],
    "ExtendedBandwidth": ["ModelPair"],
    "SegmentBase": _SEGMENT_BASE_CHILDREN,
    "SegmentList": _MULTIPLE_SEGMENT_BASE_CHILDREN + ["SegmentURL"],
    "SegmentTemplate": _MULTIPLE_SEGMENT_BASE_CHILDREN,
    "SegmentTimeline": ["Pattern", "S"],
    "Pattern": ["P"],
    "FailoverContent": ["FCS"],
    "ContentPopularityRate": ["PR"],
    "ProducerReferenceTime": ["UTCTiming"],
    "ProgramInformation": ["Title", "Source", "Copyright"],
    "Metrics": ["Range", "Reporting"],
    "InbandEventStream": [
        "Event", "BaseURL", "RequestParam", "EssentialProperty",
        "SupplementalProperty",
    ],
    "EmptyAdaptationSet": _REPRESENTATION_BASE_CHILDREN + [
        "Accessibility", "Role", "Rating", "Viewpoint", "ContentComponent",
        "BaseURL", "RequestParam", "SegmentBase", "SegmentList",
        "SegmentTemplate", "Representation",
    ],
    "ClientDataReporting": ["CMCDParameters"],
    "InsertPresentation": ["SupplementalProperty"],
    "ReplacePresentation": ["SupplementalProperty"],
}


def get_local_name(tag):
    """Extract local name from a potentially namespaced tag like {uri}local."""
    if tag and tag.startswith("{"):
        return tag.split("}", 1)[1]
    return tag or ""


def get_namespace(tag):
    """Extract namespace URI from a potentially namespaced tag."""
    if tag and tag.startswith("{"):
        return tag.split("}", 1)[0][1:]
    return ""


def detect_reorder_needs(filepath):
    """
    Use ElementTree to detect which parent elements need child reordering.

    Returns a list of dicts: [{"parent_local": str, "parent_line": int,
                                "current_order": [...], "correct_order": [...]}]
    or None if file can't be parsed.
    """
    try:
        tree = ET.parse(str(filepath))
    except ET.ParseError:
        return None

    root = tree.getroot()
    needs = []
    _detect_recursive(root, needs)
    return needs


def _detect_recursive(element, needs):
    """Recursively check element and children for ordering issues."""
    local_name = get_local_name(element.tag)
    order_list = ELEMENT_ORDER.get(local_name)

    if order_list is not None:
        children = list(element)
        if len(children) > 1:
            # Build (sort_key, original_index, child_local_name) tuples
            keyed = []
            other_counter = 0
            for i, child in enumerate(children):
                child_local = get_local_name(child.tag)
                child_ns = get_namespace(child.tag)
                if child_ns == DASH_NS and child_local in order_list:
                    key = order_list.index(child_local)
                else:
                    key = len(order_list) + other_counter
                    other_counter += 1
                keyed.append((key, i, child_local))

            current = [name for _, _, name in keyed]
            sorted_keys = sorted(keyed, key=lambda x: (x[0], x[1]))
            correct = [name for _, _, name in sorted_keys]

            if current != correct:
                needs.append({
                    "parent_local": local_name,
                    "current_order": current,
                    "correct_order": correct,
                })

    for child in element:
        _detect_recursive(child, needs)


# ── Text-based reordering ────────────────────────────────────────────────────
#
# Strategy: find the parent element in the raw text, identify each direct
# child element's text span (including preceding whitespace/comments up to
# the previous sibling), then rearrange those spans.


def find_element_local_name(text, pos):
    """
    Given a position right after '<', extract the element local name.
    Handles namespaced tags like <ns:Name and bare <Name.
    Returns (local_name, full_tag_name) or (None, None) if not an element start.
    """
    # Skip if it's a comment, PI, CDATA, or closing tag
    if pos >= len(text):
        return None, None
    ch = text[pos]
    if ch in ('!', '?', '/'):
        return None, None

    # Read until whitespace, '/', or '>'
    end = pos
    while end < len(text) and text[end] not in (' ', '\t', '\n', '\r', '/', '>'):
        end += 1

    full_tag = text[pos:end]
    # Extract local name (after ':' if namespaced)
    if ':' in full_tag:
        local = full_tag.split(':', 1)[1]
    else:
        local = full_tag

    return local, full_tag


def find_element_end(text, start):
    """
    Find the end position of an XML element starting at `start` (pointing at '<').
    Returns the position after the closing '>' of the element (or self-closing />).
    Handles nested elements, comments, CDATA, and PIs.
    """
    if start >= len(text) or text[start] != '<':
        return -1

    # Find end of the opening tag
    tag_close = _find_tag_close(text, start)
    if tag_close == -1:
        return -1

    # Check if self-closing
    if text[tag_close - 1] == '/':
        return tag_close + 1

    # Not self-closing - need to find matching closing tag
    depth = 1
    i = tag_close + 1

    while i < len(text) and depth > 0:
        if text[i] != '<':
            i += 1
            continue

        # Comment
        if text[i:i+4] == '<!--':
            end = text.find('-->', i + 4)
            if end == -1:
                return -1
            i = end + 3
            continue

        # CDATA
        if text[i:i+9] == '<![CDATA[':
            end = text.find(']]>', i + 9)
            if end == -1:
                return -1
            i = end + 3
            continue

        # PI
        if text[i:i+2] == '<?':
            end = text.find('?>', i + 2)
            if end == -1:
                return -1
            i = end + 2
            continue

        # Closing tag
        if text[i+1:i+2] == '/':
            close_end = text.find('>', i + 2)
            if close_end == -1:
                return -1
            depth -= 1
            i = close_end + 1
            if depth == 0:
                return i
            continue

        # Opening tag
        inner_close = _find_tag_close(text, i)
        if inner_close == -1:
            return -1
        if text[inner_close - 1] == '/':
            # Self-closing - depth unchanged
            i = inner_close + 1
        else:
            depth += 1
            i = inner_close + 1

    return -1


def _find_tag_close(text, start):
    """Find the closing '>' of a tag starting at '<', handling quoted attributes."""
    i = start + 1
    in_single_quote = False
    in_double_quote = False
    while i < len(text):
        ch = text[i]
        if in_single_quote:
            if ch == "'":
                in_single_quote = False
        elif in_double_quote:
            if ch == '"':
                in_double_quote = False
        elif ch == "'":
            in_single_quote = True
        elif ch == '"':
            in_double_quote = True
        elif ch == '>':
            return i
        i += 1
    return -1


def find_direct_children_spans(text, parent_start, parent_end):
    """
    Within a parent element's content (between opening and closing tags),
    find spans of each direct child element.

    Each span includes any preceding whitespace/comments that "belong" to
    that child (text between the previous child's end and this child's start).

    Returns a list of dicts:
        {"local_name": str, "full_tag": str, "span_start": int, "span_end": int,
         "elem_start": int, "elem_end": int}
    """
    # Find end of parent's opening tag
    open_tag_end = _find_tag_close(text, parent_start)
    if open_tag_end == -1:
        return []

    # Check if parent is self-closing
    if text[open_tag_end - 1] == '/':
        return []

    content_start = open_tag_end + 1

    # Find parent's closing tag start
    # We need to find the matching closing tag
    # The parent_end points after the closing '>'.
    # Walk backwards from parent_end to find '</'
    close_tag_start = text.rfind('</', content_start, parent_end)
    if close_tag_start == -1:
        return []

    content_end = close_tag_start

    # Scan for direct children within content_start..content_end
    children = []
    pos = content_start
    while pos < content_end:
        # Find next '<'
        lt = text.find('<', pos)
        if lt == -1 or lt >= content_end:
            break

        # Skip comments
        if text[lt:lt+4] == '<!--':
            comment_end = text.find('-->', lt + 4)
            if comment_end == -1:
                break
            pos = comment_end + 3
            continue

        # Skip PIs
        if text[lt:lt+2] == '<?':
            pi_end = text.find('?>', lt + 2)
            if pi_end == -1:
                break
            pos = pi_end + 2
            continue

        # Skip CDATA
        if text[lt:lt+9] == '<![CDATA[':
            cdata_end = text.find(']]>', lt + 9)
            if cdata_end == -1:
                break
            pos = cdata_end + 3
            continue

        # Skip closing tags (shouldn't happen at depth 0 before content_end)
        if text[lt+1:lt+2] == '/':
            break

        # This is a child element start
        local_name, full_tag = find_element_local_name(text, lt + 1)
        if local_name is None:
            pos = lt + 1
            continue

        elem_end = find_element_end(text, lt)
        if elem_end == -1:
            break

        children.append({
            "local_name": local_name,
            "full_tag": full_tag,
            "elem_start": lt,
            "elem_end": elem_end,
        })

        pos = elem_end

    if not children:
        return []

    # Now compute spans: each child's span includes the text from the
    # previous child's end (or content_start) up to and including the
    # child element itself.
    result = []
    for i, child in enumerate(children):
        if i == 0:
            span_start = content_start
        else:
            span_start = children[i-1]["elem_end"]

        result.append({
            "local_name": child["local_name"],
            "full_tag": child["full_tag"],
            "span_start": span_start,
            "span_end": child["elem_end"],
            "elem_start": child["elem_start"],
            "elem_end": child["elem_end"],
        })

    return result


def reorder_in_text(text, parent_local_name, order_list):
    """
    Find all instances of parent_local_name in the text and reorder their
    direct children according to order_list.

    Returns (new_text, list_of_reordered_parent_names) or (text, []) if
    no changes were needed.
    """
    changes = []

    # We process from end to start so that earlier positions remain valid
    # after modifications.

    # Find all opening tags for parent_local_name
    # Pattern: < followed by optional namespace prefix, then parent_local_name
    # This handles both <Metrics and <ns:Metrics
    parent_positions = []
    search_re = re.compile(
        r'<(?:[a-zA-Z_][\w.-]*:)?' + re.escape(parent_local_name) +
        r'(?=[\s/>])'
    )
    for m in search_re.finditer(text):
        parent_positions.append(m.start())

    # Process in reverse order
    for parent_start in reversed(parent_positions):
        parent_end = find_element_end(text, parent_start)
        if parent_end == -1:
            continue

        children = find_direct_children_spans(text, parent_start, parent_end)
        if len(children) <= 1:
            continue

        # Compute sort keys
        keyed = []
        other_counter = 0
        for i, child in enumerate(children):
            local = child["local_name"]
            if local in order_list:
                key = order_list.index(local)
            else:
                key = len(order_list) + other_counter
                other_counter += 1
            keyed.append((key, i, child))

        # Check if already in order
        current_keys = [(k, idx) for k, idx, _ in keyed]
        sorted_keys = sorted(current_keys)
        if current_keys == sorted_keys:
            continue

        # Need to reorder. Strategy:
        # - Extract "prefix text" (between previous child end and this child's
        #   element start) and "element text" for each child.
        # - Rearrange while keeping each child's prefix with it.
        # We need to be careful: the first child's "prefix" includes text from
        # the parent's opening tag end, and the last child might have trailing
        # text before the parent's closing tag.

        # For simplicity and correctness, we extract each child as:
        #   prefix = text from previous_elem_end to this elem_start
        #   body = text from this elem_start to this elem_end
        # Then the overall content between parent's opening tag end and
        # closing tag start is:
        #   preamble + [prefix_0 + body_0] + [prefix_1 + body_1] + ... + epilogue

        open_tag_end = _find_tag_close(text, parent_start) + 1
        close_tag_start = text.rfind('</', open_tag_end, parent_end)

        # Preamble: text from open_tag_end to first child's elem_start
        preamble = text[open_tag_end:children[0]["elem_start"]]
        # Epilogue: text from last child's elem_end to close_tag_start
        epilogue = text[children[-1]["elem_end"]:close_tag_start]

        # For each child, extract prefix (whitespace/comments before it)
        # and body (the element itself)
        child_parts = []
        for i, child in enumerate(children):
            if i == 0:
                prefix = ""  # preamble handles this
            else:
                prefix = text[children[i-1]["elem_end"]:child["elem_start"]]
            body = text[child["elem_start"]:child["elem_end"]]
            child_parts.append({"prefix": prefix, "body": body, "local_name": child["local_name"]})

        # Sort child_parts according to keyed order
        sorted_indices = [idx for _, idx, _ in sorted(keyed, key=lambda x: (x[0], x[1]))]
        sorted_parts = [child_parts[i] for i in sorted_indices]

        # Rebuild the content
        # First child in new order gets preamble before it, rest get their
        # original prefix. But we want to preserve the *indentation pattern*,
        # so we swap prefixes along with bodies.
        # Actually, the cleanest approach: each child keeps its own prefix.
        # The first child in the new order uses the preamble + no prefix.
        # Other children use their original prefix.
        # But this can be tricky if prefixes contain comments related to
        # specific children. Since we're only doing minimal reordering,
        # let's keep the original prefix pattern: assign the original
        # positional prefixes to the new positions.

        # Use the original prefix pattern (prefix[0] is empty, prefix[1..n]
        # are the whitespace between children).
        original_prefixes = [p["prefix"] for p in child_parts]

        new_content = preamble
        for i, part_idx in enumerate(sorted_indices):
            if i == 0:
                new_content += child_parts[part_idx]["body"]
            else:
                new_content += original_prefixes[i] + child_parts[part_idx]["body"]
        new_content += epilogue

        # Replace in text
        old_content = text[open_tag_end:close_tag_start]
        if new_content != old_content:
            text = text[:open_tag_end] + new_content + text[close_tag_start:]
            changes.append(parent_local_name)

    return text, changes


def fix_mpd_file(filepath, dry_run=False):
    """
    Fix element ordering in a single MPD file.

    Returns a dict with:
        - 'changed': bool
        - 'reordered_elements': list of parent element names that were reordered
        - 'error': str or None
    """
    # Step 1: Detect which parents need reordering using ElementTree
    needs = detect_reorder_needs(filepath)
    if needs is None:
        # Try to read and see if it's a parse error
        try:
            ET.parse(str(filepath))
            return {"changed": False, "reordered_elements": [], "error": None}
        except ET.ParseError as e:
            return {"changed": False, "reordered_elements": [], "error": f"XML parse error: {e}"}

    if not needs:
        return {"changed": False, "reordered_elements": [], "error": None}

    # Step 2: Read raw text and perform text-based reordering
    try:
        text = filepath.read_text(encoding="utf-8")
    except Exception as e:
        return {"changed": False, "reordered_elements": [], "error": f"Read error: {e}"}

    all_changes = []
    for need in needs:
        parent_local = need["parent_local"]
        order_list = ELEMENT_ORDER.get(parent_local, [])
        if not order_list:
            continue
        text, changes = reorder_in_text(text, parent_local, order_list)
        all_changes.extend(changes)

    if not all_changes:
        return {"changed": False, "reordered_elements": [], "error": None}

    if not dry_run:
        filepath.write_text(text, encoding="utf-8")

    return {"changed": True, "reordered_elements": all_changes, "error": None}


def main():
    parser = argparse.ArgumentParser(
        description="Fix element ordering in DASH MPD files to comply with the XSD schema."
    )
    parser.add_argument(
        "directory",
        nargs="?",
        default="downloaded_mpds",
        help="Directory containing .mpd files (default: downloaded_mpds)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Report what would be changed without modifying files",
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Show details for each file processed",
    )
    args = parser.parse_args()

    script_dir = Path(__file__).parent
    target_dir = script_dir / args.directory

    if not target_dir.is_dir():
        print(f"Error: Directory not found: {target_dir}", file=sys.stderr)
        sys.exit(1)

    mpd_files = sorted(target_dir.glob("**/*.mpd"))

    if not mpd_files:
        print(f"No .mpd files found in {target_dir}", file=sys.stderr)
        sys.exit(1)

    # Process all files
    results = []
    for mpd_file in mpd_files:
        rel_path = mpd_file.relative_to(script_dir)
        result = fix_mpd_file(mpd_file, dry_run=args.dry_run)
        result["file"] = str(rel_path)
        results.append(result)

        if args.verbose:
            if result["error"]:
                print(f"  ERROR  {rel_path}: {result['error']}")
            elif result["changed"]:
                elements = ", ".join(result["reordered_elements"])
                print(f"  FIXED  {rel_path}: reordered children of [{elements}]")
            else:
                print(f"  OK     {rel_path}")

    # Generate report
    changed = [r for r in results if r["changed"]]
    errors = [r for r in results if r["error"]]
    unchanged = [r for r in results if not r["changed"] and not r["error"]]

    print()
    print("=" * 72)
    print("  MPD Element Reordering Report")
    print("=" * 72)
    print()
    print(f"  Date          : {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"  Directory     : {target_dir}")
    print(f"  Mode          : {'DRY RUN' if args.dry_run else 'APPLIED'}")
    print(f"  Files scanned : {len(results)}")
    print(f"  Files modified: {len(changed)}")
    print(f"  Files OK      : {len(unchanged)}")
    print(f"  Files errored : {len(errors)}")
    print()

    if changed:
        print("-" * 72)
        action = "would reorder" if args.dry_run else "reordered"
        print(f"  Files that {action} ({len(changed)}):")
        print("-" * 72)
        for r in changed:
            elements = ", ".join(r["reordered_elements"])
            print(f"    {r['file']}")
            print(f"      Reordered children of: {elements}")
        print()

    if errors:
        print("-" * 72)
        print(f"  Files with errors ({len(errors)}):")
        print("-" * 72)
        for r in errors:
            print(f"    {r['file']}: {r['error']}")
        print()

    print("=" * 72)

    # Write report file
    report_path = script_dir / "reorder_report.txt"
    with open(report_path, "w") as f:
        f.write("MPD Element Reordering Report\n")
        f.write(f"Date: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
        f.write(f"Directory: {target_dir}\n")
        f.write(f"Mode: {'DRY RUN' if args.dry_run else 'APPLIED'}\n")
        f.write(f"Files scanned: {len(results)}\n")
        f.write(f"Files modified: {len(changed)}\n")
        f.write(f"Files OK: {len(unchanged)}\n")
        f.write(f"Files errored: {len(errors)}\n")
        f.write("\n")
        if changed:
            f.write("Files reordered:\n")
            for r in changed:
                elements = ", ".join(r["reordered_elements"])
                f.write(f"  {r['file']}\n")
                f.write(f"    Reordered children of: {elements}\n")
            f.write("\n")
        if errors:
            f.write("Files with errors:\n")
            for r in errors:
                f.write(f"  {r['file']}: {r['error']}\n")
            f.write("\n")

    print(f"  Report written to: {report_path.relative_to(script_dir)}")
    print("=" * 72)


if __name__ == "__main__":
    main()
