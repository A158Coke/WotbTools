"""Materialize the reviewed Agent asset plane's compact local shooting inputs.

The source remains tank/{id}.json. This snapshot carries no GLB, texture, name,
or second tankopedia; it preserves config ordering, pitch limits and global
shell identity used by ReplayShotsPane. Missing source files abort the update.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
import urllib.request


def download(url):
    with urllib.request.urlopen(url, timeout=45) as response:
        return response.read()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--asset-base", required=True)
    args = parser.parse_args()
    base = args.asset_base.rstrip("/")
    if not base.startswith("https://"):
        parser.error("asset-base must be the reviewed HTTPS asset origin")
    cache_bytes = download(base + "/data/tank_cache.json")
    cache = json.loads(cache_bytes)
    if not isinstance(cache, dict) or not cache:
        raise ValueError("empty or invalid tank cache")
    ids = sorted(cache, key=int)

    def materialize(tank_id):
        raw = download(base + "/tank/" + tank_id + ".json")
        data = json.loads(raw)
        configs = data.get("configs")
        if not isinstance(configs, list):
            raise ValueError("missing configs: " + tank_id)
        compact = []
        for config in configs:
            compact.append({key: config[key] for key in ("pitch_limits", "shell_global_ids") if key in config})
        return tank_id, {"configs": compact}, hashlib.sha256(raw).hexdigest()

    with ThreadPoolExecutor(max_workers=16) as pool:
        records = list(pool.map(materialize, ids))
    source_digest = hashlib.sha256(json.dumps({item[0]: item[2] for item in records}, sort_keys=True).encode()).hexdigest()
    output = {
        "schemaVersion": 1,
        "source": {"assetBase": base, "tankCacheSha256": hashlib.sha256(cache_bytes).hexdigest(),
                   "tankSourceSha256": source_digest, "tankCount": len(records)},
        "tanks": {tank_id: data for tank_id, data, _ in records},
    }
    target = Path(__file__).resolve().parents[1] / "shot-tank-data.json"
    with target.open("w", encoding="utf-8", newline="\n") as stream:
        stream.write(json.dumps(output, ensure_ascii=False, separators=(",", ":")) + "\n")
    print(f"Materialized {len(records)} shooting entries ({target.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
