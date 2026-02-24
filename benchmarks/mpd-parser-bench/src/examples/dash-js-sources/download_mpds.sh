#!/usr/bin/env bash
set -u

SOURCE_JSON="${1:-sources.json}"
OUTPUT_DIR="${2:-.}"
URL_LIST_FILE="${OUTPUT_DIR%/}/mpd_urls.txt"
MAP_FILE="${OUTPUT_DIR%/}/downloaded_mpd_map.tsv"
FAILED_FILE="${OUTPUT_DIR%/}/failed_mpd_urls.txt"

if [ ! -f "$SOURCE_JSON" ]; then
    echo "Error: source file not found: $SOURCE_JSON" >&2
    exit 1
fi

mkdir -p "$OUTPUT_DIR"
rm -f "$URL_LIST_FILE" "$MAP_FILE" "$FAILED_FILE"

jq -r '
  .. | strings
  | gsub("^\\s+|\\s+$"; "")
  | select(test("^https?://"; "i"))
  | select(test("\\.mpd(\\?.*)?$"; "i"))
' "$SOURCE_JSON" | sort -u > "$URL_LIST_FILE"

TOTAL="$(wc -l < "$URL_LIST_FILE" | tr -d ' ')"
if [ "$TOTAL" -eq 0 ]; then
    echo "No MPD URLs found in $SOURCE_JSON"
    exit 0
fi

echo "Found $TOTAL MPD URLs"

i=0
while IFS= read -r url; do
    i=$((i + 1))

    safe_name="$(printf '%s' "$url" | sed -E 's#^https?://##; s#[^A-Za-z0-9._-]+#_#g')"
    safe_name="${safe_name%%.mpd*}.mpd"
    safe_name="${safe_name:0:200}"
    out_file="$(printf '%03d_%s' "$i" "$safe_name")"
    out_path="${OUTPUT_DIR%/}/$out_file"

    echo "[$i/$TOTAL] $url"
    if curl -fsSL --connect-timeout 15 --max-time 120 --retry 2 --output "$out_path" "$url"; then
        printf '%s\t%s\n' "$url" "$out_file" >> "$MAP_FILE"
    else
        echo "Failed: $url" >&2
        printf '%s\n' "$url" >> "$FAILED_FILE"
    fi
done < "$URL_LIST_FILE"

downloaded_count="$(wc -l < "$MAP_FILE" 2>/dev/null | tr -d ' ')"
failed_count="$(wc -l < "$FAILED_FILE" 2>/dev/null | tr -d ' ')"

echo
echo "Done"
echo "- URL list: $URL_LIST_FILE"
echo "- Download map: $MAP_FILE"
echo "- Downloaded: ${downloaded_count:-0}"
echo "- Failed: ${failed_count:-0}"
