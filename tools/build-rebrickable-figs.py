#!/usr/bin/env python3
"""Builds public/data/rebrickable-set-figs.json: for every set Rebrickable lists
minifigs for, its latest inventory's minifigs (fig number, name, quantity).

The Sort List's fallback uses it when BrickLink can't be reached (see
loadSortFallback in public/index.html). It's built from Rebrickable's public CSV
downloads, so nothing calls Rebrickable's overloaded API at run time.

Usage:
  python3 tools/build-rebrickable-figs.py            # downloads the CSVs
  python3 tools/build-rebrickable-figs.py DIR        # uses CSVs already in DIR

Needs minifigs, inventories and inventory_minifigs (.csv.gz) from
https://cdn.rebrickable.com/media/downloads/ . Check Rebrickable's Downloads
page for their terms on using the data.
"""
import csv
import datetime
import gzip
import json
import os
import sys
import urllib.request

BASE = "https://cdn.rebrickable.com/media/downloads/"
NEEDED = ["minifigs", "inventories", "inventory_minifigs"]
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public", "data", "rebrickable-set-figs.json")


def open_csv(name, src_dir):
    path = os.path.join(src_dir, name + ".csv.gz") if src_dir else None
    if path and os.path.exists(path):
        return csv.DictReader(gzip.open(path, "rt", encoding="utf-8"))
    raw = urllib.request.urlopen(BASE + name + ".csv.gz", timeout=120).read()
    return csv.DictReader(gzip.decompress(raw).decode("utf-8").splitlines())


def main():
    src_dir = sys.argv[1] if len(sys.argv) > 1 else None
    figs = {r["fig_num"]: r["name"] for r in open_csv("minifigs", src_dir)}

    # The newest inventory version of each set is the one to use.
    latest = {}
    for r in open_csv("inventories", src_dir):
        v = int(r["version"])
        if r["set_num"] not in latest or v > latest[r["set_num"]][0]:
            latest[r["set_num"]] = (v, r["id"])

    by_inventory = {}
    for r in open_csv("inventory_minifigs", src_dir):
        by_inventory.setdefault(r["inventory_id"], []).append(r)

    sets = {}
    for set_num, (_, inv_id) in latest.items():
        rows = [[r["fig_num"], figs[r["fig_num"]], int(r["quantity"])]
                for r in by_inventory.get(inv_id, []) if r["fig_num"] in figs]
        if rows:
            sets[set_num] = rows

    out = {"generated": datetime.date.today().isoformat(), "source": BASE, "sets": sets}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, separators=(",", ":"), ensure_ascii=False)
    print("wrote %d sets to %s (%d bytes)" % (len(sets), os.path.normpath(OUT), os.path.getsize(OUT)))


if __name__ == "__main__":
    main()
