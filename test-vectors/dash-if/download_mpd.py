#!/usr/bin/env python3
"""
Download MPD files from DASH-IF test vectors CSV and generate reports.
"""

import csv
import os
import subprocess
import sys
from pathlib import Path
from datetime import datetime
from urllib.parse import urlparse

# Configuration
CSV_FILE = "test-vectors.csv"
DOWNLOAD_DIR = "downloaded_mpds"
SUCCESS_REPORT = "download_success_report.txt"
FAILURE_REPORT = "download_failure_report.txt"
MODIFIED_REPORT = "download_modified_report.txt"


def sanitize_filename(name):
    """Create a safe filename from identifier."""
    return "".join(c if c.isalnum() or c in ('-', '_') else '_' for c in name).strip('_')


def get_url_path(url):
    """Extract path from URL, removing query strings and anchors."""
    parsed = urlparse(url)
    return parsed.path


def is_mpd_url(url):
    """Check if URL points to an MPD file (handles anchors and query strings)."""
    path = get_url_path(url)
    return path.endswith('.mpd')


def is_hls_url(url):
    """Check if URL is an HLS playlist."""
    path = get_url_path(url)
    return path.endswith('.m3u8')


def fix_livesim_url(url):
    """Fix livesim URLs by replacing livesim-dev with livesim.
    Returns (fixed_url, was_modified)."""
    if url.startswith('https://livesim.dashif.org/livesim-dev/'):
        fixed = url.replace('https://livesim.dashif.org/livesim-dev/', 
                           'https://livesim.dashif.org/livesim/', 1)
        return fixed, True
    return url, False


def download_mpd(url, output_path):
    """Download MPD using curl. Returns (success, error_message)."""
    try:
        result = subprocess.run(
            ['curl', '-s', '-L', '-o', output_path, '--max-time', '30', url],
            capture_output=True,
            text=True,
            check=False
        )
        if result.returncode != 0:
            return False, f"curl failed with code {result.returncode}: {result.stderr}"
        
        # Check if file was actually downloaded and has content
        if not os.path.exists(output_path):
            return False, "File not created"
        if os.path.getsize(output_path) == 0:
            os.remove(output_path)
            return False, "Downloaded file is empty"
        
        return True, None
    except Exception as e:
        return False, str(e)


def main():
    # Create download directory
    os.makedirs(DOWNLOAD_DIR, exist_ok=True)
    
    success_entries = []
    failure_entries = []
    modified_entries = []
    
    # Read CSV and process
    with open(CSV_FILE, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f, delimiter=';')
        
        for idx, row in enumerate(reader, 1):
            url = row.get('URL', '').strip()
            identifier = row.get('identifier', '').strip()
            testvector = row.get('Testvector', '').strip()
            feature = row.get('Feature', '').strip()
            testcase = row.get('Testcase', '').strip()
            
            # Skip if no URL
            if not url:
                failure_entries.append({
                    'idx': idx,
                    'testvector': testvector,
                    'identifier': identifier,
                    'url': 'NO URL',
                    'error': 'No URL provided in CSV'
                })
                print(f"[{idx}] SKIPPED (no URL): {testvector}")
                continue
            
            # Skip HLS playlists (.m3u8)
            if is_hls_url(url):
                print(f"[{idx}] SKIPPED (HLS playlist): {testvector}")
                continue
            
            # Skip non-MPD URLs
            if not is_mpd_url(url):
                failure_entries.append({
                    'idx': idx,
                    'testvector': testvector,
                    'identifier': identifier,
                    'url': url,
                    'error': 'Not an MPD file (different extension)'
                })
                print(f"[{idx}] SKIPPED (not MPD): {testvector}")
                continue
            
            # Fix livesim URLs and track modifications
            original_url = url
            url, was_modified = fix_livesim_url(url)
            
            # Create unique filename using identifier or row number
            if identifier:
                base_id = sanitize_filename(identifier)
            else:
                base_id = f"row_{idx}"
            
            # Extract original filename from URL path (without query/anchor)
            url_path = get_url_path(url)
            original_name = os.path.basename(url_path) or "manifest.mpd"
            
            # Create unique filename: {identifier}__{original_name}
            unique_filename = f"{base_id}__{original_name}"
            output_path = os.path.join(DOWNLOAD_DIR, unique_filename)
            
            print(f"[{idx}] Downloading: {testvector}")
            print(f"      URL: {url}")
            print(f"      File: {unique_filename}")
            
            # Download
            success, error = download_mpd(url, output_path)
            
            entry = {
                'idx': idx,
                'testvector': testvector,
                'identifier': identifier,
                'feature': feature,
                'testcase': testcase,
                'url': url,
                'filename': unique_filename,
                'original_name': original_name,
                'original_url': original_url if was_modified else None
            }
            
            if success:
                success_entries.append(entry)
                if was_modified:
                    modified_entries.append(entry)
                    print(f"      ✓ SUCCESS (URL modified)")
                else:
                    print(f"      ✓ SUCCESS")
            else:
                entry['error'] = error
                failure_entries.append(entry)
                print(f"      ✗ FAILED: {error}")
            
            print()
    
    # Generate timestamp
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    
    # Write success report
    with open(SUCCESS_REPORT, 'w', encoding='utf-8') as f:
        f.write("=" * 80 + "\n")
        f.write("DASH-IF TEST VECTOR MPD DOWNLOAD - SUCCESS REPORT\n")
        f.write(f"Generated: {timestamp}\n")
        f.write("=" * 80 + "\n\n")
        f.write(f"Total successful downloads: {len(success_entries)}\n\n")
        
        for entry in success_entries:
            f.write(f"[{entry['idx']}] {entry['testvector']}\n")
            f.write(f"    Identifier: {entry['identifier']}\n")
            f.write(f"    Feature: {entry['feature']}\n")
            f.write(f"    Testcase: {entry['testcase']}\n")
            f.write(f"    URL: {entry['url']}\n")
            f.write(f"    Saved as: {entry['filename']}\n")
            f.write(f"    Original name: {entry['original_name']}\n")
            f.write("\n")
    
    # Write failure report
    with open(FAILURE_REPORT, 'w', encoding='utf-8') as f:
        f.write("=" * 80 + "\n")
        f.write("DASH-IF TEST VECTOR MPD DOWNLOAD - FAILURE REPORT\n")
        f.write(f"Generated: {timestamp}\n")
        f.write("=" * 80 + "\n\n")
        f.write(f"Total failed downloads: {len(failure_entries)}\n\n")
        
        for entry in failure_entries:
            f.write(f"[{entry['idx']}] {entry.get('testvector', 'N/A')}\n")
            f.write(f"    Identifier: {entry.get('identifier', 'N/A')}\n")
            f.write(f"    URL: {entry['url']}\n")
            f.write(f"    Error: {entry.get('error', 'Unknown error')}\n")
            f.write("\n")
    
    # Write modified URLs report
    with open(MODIFIED_REPORT, 'w', encoding='utf-8') as f:
        f.write("=" * 80 + "\n")
        f.write("DASH-IF TEST VECTOR MPD DOWNLOAD - MODIFIED URLS REPORT\n")
        f.write(f"Generated: {timestamp}\n")
        f.write("=" * 80 + "\n\n")
        f.write(f"Total modified URLs: {len(modified_entries)}\n\n")
        f.write("These URLs were automatically fixed to enable successful download:\n")
        f.write("(livesim-dev -> livesim)\n\n")

        for entry in modified_entries:
            f.write(f"[{entry['idx']}] {entry['testvector']}\n")
            f.write(f"    Identifier: {entry['identifier']}\n")
            f.write(f"    Feature: {entry['feature']}\n")
            f.write(f"    Testcase: {entry['testcase']}\n")
            f.write(f"    ORIGINAL URL: {entry['original_url']}\n")
            f.write(f"    MODIFIED URL: {entry['url']}\n")
            f.write(f"    Saved as: {entry['filename']}\n")
            f.write("\n")

    # Print summary
    print("=" * 80)
    print("DOWNLOAD COMPLETE")
    print("=" * 80)
    print(f"Successful: {len(success_entries)}")
    print(f"Modified URLs: {len(modified_entries)}")
    print(f"Failed: {len(failure_entries)}")
    print(f"\nReports saved:")
    print(f"  - Success: {SUCCESS_REPORT}")
    print(f"  - Modified: {MODIFIED_REPORT}")
    print(f"  - Failures: {FAILURE_REPORT}")
    print(f"  - Downloads: {DOWNLOAD_DIR}/")


if __name__ == "__main__":
    main()
