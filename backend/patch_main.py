from pathlib import Path

TOP_ENDPOINT = r'''
@app.get("/top")
def get_top(country: str = "uy", range: str = "24h", q: str = "", limit: int = 30):
    """
    Top Stories: cluster-first feed intended for the homepage.
    Returns the same general shape as /clusters but optimized for "top stories".
    """
    c = (country or "uy").strip().lower()

    try:
        lim = int(limit)
    except Exception:
        lim = 30

    # Keep your existing "all" hard cap behavior
    lim = _hard_cap_limit(c, lim)

    scan_cap = min(3000, max(300, lim * 14))
    raw = _collect_items(country=c, range=range, q=q, scan_cap=scan_cap)

    groups: Dict[str, List[Dict[str, Any]]] = {}
    for a in raw:
        cid = _sig(a)
        groups.setdefault(cid, []).append(a)

    clusters: List[Dict[str, Any]] = []
    for cid, items in groups.items():
        for it in items:
            it["topic"] = _topic_label(it)
            score, factors = _rank_score_and_factors(it)
            it["rank_score"] = score
            it["rank_factors"] = factors

        best = items[0]
        for it in items[1:]:
            if _quality_score(it) > _quality_score(best):
                best = it
            elif _quality_score(it) == _quality_score(best):
                if float(it.get("rank_score") or 0.0) > float(best.get("rank_score") or 0.0):
                    best = it

        seen_sources: Dict[str, Dict[str, Any]] = {}
        for it in items:
            sname = (it.get("source") or "").strip() or "Unknown"
            if sname not in seen_sources:
                seen_sources[sname] = {
                    "source": sname,
                    "link": it.get("link") or "",
                    "published_utc": it.get("published_utc") or "",
                }

        sources_list = list(seen_sources.values())
        cluster_topic = best.get("topic") or GENERAL_LABEL

        best_out = dict(best)
        best_out["cluster_id"] = cid

        clusters.append(
            {
                "cluster_id": cid,
                "topic": cluster_topic,
                "duplicates_count": len(items),
                "sources_count": len(sources_list),
                "sources": sources_list,
                "best_item": best_out,
            }
        )

    clusters.sort(
        key=lambda cobj: (
            float(((cobj.get("best_item") or {}).get("rank_score") or 0.0)),
            ((cobj.get("best_item") or {}).get("published_utc") or ""),
        ),
        reverse=True,
    )

    clusters = clusters[:lim]
    return {"country": c, "range": range, "q": q, "limit": lim, "count": len(clusters), "clusters": clusters}
'''.lstrip("\n")

def main():
    # Because this script is inside backend/, main.py is in the same folder.
    path = Path("main.py")
    if not path.exists():
        raise SystemExit("ERROR: main.py not found. Make sure you're running this inside the backend folder.")

    text = path.read_text(encoding="utf-8")
    old_lines = text.count("\n") + 1

    if '@app.get("/top")' in text:
        raise SystemExit("ABORT: /top endpoint already exists in main.py")

    marker = '@app.post("/enrich")'
    idx = text.find(marker)
    if idx == -1:
        raise SystemExit('ERROR: Could not find insertion marker @app.post("/enrich")')

    # Backup first (backend/main.py.bak)
    backup = Path("main.py.bak")
    backup.write_text(text, encoding="utf-8")

    new_text = text[:idx] + "\n\n" + TOP_ENDPOINT + "\n\n" + text[idx:]
    path.write_text(new_text, encoding="utf-8")
    new_lines = new_text.count("\n") + 1

    print("OK: Inserted /top endpoint into backend/main.py")
    print("Backup written to: backend/main.py.bak (same folder)")
    print(f"Old line count: {old_lines}")
    print(f"New line count: {new_lines}")

if __name__ == "__main__":
    main()