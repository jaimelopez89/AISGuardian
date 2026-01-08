#!/usr/bin/env python3
"""
Fetch sanctioned tanker data from TankerTrackers.com and merge with shadow fleet database.

TankerTrackers maintains a list of ~1,300 sanctioned tankers from:
- OFAC (US Treasury)
- FCDO (UK Foreign Office)
- UANI (United Against Nuclear Iran)
- EU Council Sanctions
- ASO, MFAT, GAC, SECO, UN

Usage:
    python fetch_tankertrackers.py           # Fetch and merge
    python fetch_tankertrackers.py --dry-run # Preview without saving
"""

import json
import re
import sys
from datetime import datetime
from pathlib import Path

import requests
from bs4 import BeautifulSoup


TANKERTRACKERS_URL = "https://tankertrackers.com/report/sanctioned"
SHADOW_FLEET_FILE = Path(__file__).parent / "shadow_fleet.json"


def fetch_tankertrackers():
    """Fetch and parse sanctioned vessels from TankerTrackers.com."""
    print(f"Fetching data from {TANKERTRACKERS_URL}...")

    headers = {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AISGuardian/1.0'
    }

    try:
        response = requests.get(TANKERTRACKERS_URL, headers=headers, timeout=30)
        response.raise_for_status()
    except requests.RequestException as e:
        print(f"ERROR: Failed to fetch TankerTrackers: {e}")
        return []

    soup = BeautifulSoup(response.text, 'html.parser')

    # Find the data table - TankerTrackers uses a table for vessel list
    vessels = []

    # Look for table rows with vessel data
    # The page structure may vary, try multiple approaches

    # Approach 1: Look for table with vessel data
    tables = soup.find_all('table')
    for table in tables:
        rows = table.find_all('tr')
        for row in rows:
            cells = row.find_all(['td', 'th'])
            if len(cells) >= 3:
                # Try to extract IMO and vessel name
                text = ' '.join(cell.get_text(strip=True) for cell in cells)

                # Look for IMO numbers (9 digits)
                imo_match = re.search(r'\b(9\d{6})\b', text)
                if imo_match:
                    imo = imo_match.group(1)

                    # Extract vessel name (usually first cell or before IMO)
                    name = cells[0].get_text(strip=True) if cells else ""

                    # Try to extract flag
                    flag = ""
                    for cell in cells:
                        cell_text = cell.get_text(strip=True)
                        if len(cell_text) == 2 and cell_text.isupper():
                            flag = cell_text
                            break

                    vessels.append({
                        'imo': imo,
                        'name': name,
                        'flag': flag,
                        'type': 'tanker',
                        'source': 'TankerTrackers'
                    })

    # Approach 2: Look for divs/spans with vessel data
    if not vessels:
        # Try finding text patterns directly
        text = soup.get_text()

        # Find all IMO numbers with context
        imo_pattern = r'([A-Z][A-Z\s]+?)\s*(?:\(|\[)?IMO[:\s]*(\d{7})(?:\)|\])?'
        matches = re.findall(imo_pattern, text, re.IGNORECASE)

        for name, imo in matches:
            name = name.strip()
            if len(name) > 2 and len(name) < 50:
                vessels.append({
                    'imo': imo,
                    'name': name,
                    'flag': '',
                    'type': 'tanker',
                    'source': 'TankerTrackers'
                })

    # Approach 3: Parse JSON data if embedded
    if not vessels:
        scripts = soup.find_all('script')
        for script in scripts:
            script_text = script.string or ''
            if 'IMO' in script_text or 'vessel' in script_text.lower():
                # Try to extract JSON data
                json_matches = re.findall(r'\{[^{}]*"imo"[^{}]*\}', script_text)
                for match in json_matches:
                    try:
                        data = json.loads(match)
                        if 'imo' in data:
                            vessels.append({
                                'imo': str(data.get('imo', '')),
                                'name': data.get('name', data.get('vessel', '')),
                                'flag': data.get('flag', ''),
                                'type': 'tanker',
                                'source': 'TankerTrackers'
                            })
                    except json.JSONDecodeError:
                        pass

    print(f"  Found {len(vessels)} vessels from TankerTrackers")
    return vessels


def load_shadow_fleet():
    """Load existing shadow fleet database."""
    if not SHADOW_FLEET_FILE.exists():
        return {'metadata': {}, 'vessels': []}

    with open(SHADOW_FLEET_FILE, 'r') as f:
        return json.load(f)


def merge_vessels(existing_data, new_vessels):
    """Merge new vessels into existing database, avoiding duplicates."""
    existing_vessels = existing_data.get('vessels', [])
    existing_imos = {v.get('imo') for v in existing_vessels if v.get('imo')}

    added = 0
    updated = 0

    for new_vessel in new_vessels:
        imo = new_vessel.get('imo')
        if not imo:
            continue

        if imo in existing_imos:
            # Update existing vessel with TankerTrackers source if not already present
            for existing in existing_vessels:
                if existing.get('imo') == imo:
                    if 'TankerTrackers' not in existing.get('sanctions', []):
                        if 'sanctions' not in existing:
                            existing['sanctions'] = []
                        if 'TT' not in existing['sanctions']:
                            existing['sanctions'].append('TT')
                            updated += 1
                    break
        else:
            # Add new vessel
            existing_vessels.append({
                'imo': imo,
                'name': new_vessel.get('name', ''),
                'flag': new_vessel.get('flag', ''),
                'type': 'tanker',
                'sanctions': ['TT'],  # TankerTrackers
                'risk_level': 'high',
                'notes': f"Added from TankerTrackers {datetime.utcnow().strftime('%Y-%m-%d')}"
            })
            existing_imos.add(imo)
            added += 1

    existing_data['vessels'] = existing_vessels
    existing_data['metadata']['last_updated'] = datetime.utcnow().strftime('%Y-%m-%d')
    existing_data['metadata']['total_vessels'] = len(existing_vessels)

    if 'TankerTrackers.com' not in existing_data['metadata'].get('sources', []):
        existing_data['metadata'].setdefault('sources', []).append('TankerTrackers.com')

    return existing_data, added, updated


def save_shadow_fleet(data):
    """Save updated shadow fleet database."""
    with open(SHADOW_FLEET_FILE, 'w') as f:
        json.dump(data, f, indent=2)
    print(f"  Saved to {SHADOW_FLEET_FILE}")


def main():
    dry_run = '--dry-run' in sys.argv

    print("=" * 60)
    print("TankerTrackers.com Sanctioned Vessels Fetcher")
    print("=" * 60)

    # Fetch new data
    new_vessels = fetch_tankertrackers()

    if not new_vessels:
        print("\nWARNING: Could not parse vessels from TankerTrackers.")
        print("The page structure may have changed. Manual review needed.")
        print("\nTrying alternative: extracting IMOs from page text...")

        # Fallback: just get raw text and find IMOs
        try:
            response = requests.get(TANKERTRACKERS_URL, timeout=30)
            text = response.text

            # Find all 7-digit numbers starting with 9 (IMO format)
            imos = set(re.findall(r'\b(9\d{6})\b', text))
            print(f"  Found {len(imos)} unique IMO numbers in page")

            new_vessels = [{'imo': imo, 'name': '', 'flag': '', 'type': 'tanker', 'source': 'TankerTrackers'} for imo in imos]
        except Exception as e:
            print(f"  Fallback also failed: {e}")

    # Load existing data
    existing_data = load_shadow_fleet()
    existing_count = len(existing_data.get('vessels', []))
    print(f"\nExisting shadow fleet: {existing_count} vessels")

    # Merge
    merged_data, added, updated = merge_vessels(existing_data, new_vessels)
    new_count = len(merged_data.get('vessels', []))

    print(f"\nMerge results:")
    print(f"  New vessels added: {added}")
    print(f"  Existing vessels updated: {updated}")
    print(f"  Total vessels now: {new_count}")

    if dry_run:
        print("\n[DRY RUN] No changes saved.")
    else:
        save_shadow_fleet(merged_data)
        print("\nDone! Run 'python load_sanctions.py' to push to Kafka.")


if __name__ == '__main__':
    main()
