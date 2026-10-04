#!/usr/bin/env python3
"""korean-law 스킬 보조 스크립트.

판정은 엔진(verify_document)과 이 스크립트가 규칙대로 내린다. LLM은 도구를 호출하고 결과와 문맥 확인을 파일로 넘기기만 한다.

  init     입력 문서를 실행 폴더로 복사한다
  parse    verify_document 판정 JSON(raw/document-N.json)을 항목(items.json)으로 모으고 문맥 확인 목록을 낸다
  build    items.json + overrides.json으로 최종 판정과 검증표(evidence.json, evidence.md)를 만든다
  score    시드 평가 세트를 채점한다
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import sys
from pathlib import Path

SCHEMA = "korean-law/evidence@2"

# 상태 → (등급, 설명, 기본 수정 안내). 엔진 mcp/src/verdict.ts 의 GATE_STATUS와 같은 표다
STATUS = {
    "OK": ("PASS", "실존 확인", ""),
    "OK_ALIAS": ("PASS", "약칭, 정식 법령에서 확인", "처음 나올 때 정식 법령명을 병기한다"),
    "FAIL_NOT_FOUND": ("FAIL", "조문 없음", "올바른 조문 번호를 찾아 고치거나 인용을 뺀다"),
    "FAIL_MISMATCH": ("FAIL", "조문 제목 불일치", "조문 번호와 제목 중 무엇이 맞는지 확인해 고친다"),
    "FAIL_LAW_NOT_FOUND": ("FAIL", "법령 부존재", "실제 법령을 찾아 바꾸거나 인용을 뺀다"),
    "FAIL_IMPOSSIBLE_CASE": ("FAIL", "실존 불가 사건번호", "판례 인용을 빼거나 실제 사건번호로 바꾼다"),
    "FAIL_CASE_MISMATCH": ("FAIL", "사건번호는 실존하나 인용한 선고일과 다름", "실제 판례를 찾아 사건번호와 선고일을 바로잡거나 인용을 뺀다"),
    "FAIL_REPEALED": ("FAIL", "폐지 법령을 현행처럼 인용", "후속 법령으로 바꾸거나 '구 ○○법'과 적용 시점을 명시한다"),
    "FAIL_DELETED": ("FAIL", "삭제된 조문", "삭제 사실을 반영해 고치거나 인용을 뺀다"),
    "FAIL_OVERRULED": ("FAIL", "변경·폐기된 판례", "변경한 후속 판결을 인용하거나 변경 사실을 명시한다"),
    "WARN_RENAMED": ("WARN", "옛 법령명", "현행 법령명으로 고치고 조문 번호를 다시 확인한다"),
    "WARN_TITLE_DIFF": ("WARN", "인용한 조문 제목이 실제 제목과 다름 (엔진은 일치로 봄)", "조문 제목을 실제 제목으로 고친다"),
    "WARN_NOT_YET_EFFECTIVE": ("WARN", "아직 시행되지 않은 신설 조문·항 (공포됐으나 시행 전)", "시행일을 명시하거나, 현재 적용 조문으로 쓰지 않는다"),
    "WARN_PENDING_CHANGE": ("WARN", "현재 유효하나 시행 예정 개정이 있음 (조문이 바뀌거나 삭제될 예정)", "시행일 전후 어느 조문을 적용하는지 명시한다"),
    "WARN_REPEALED_HISTORICAL": ("WARN", "구법 인용, 적용 시점 확인 필요", "행위 시점이 구법 시행 기간인지 본문에 명시한다"),
    "WARN_CASE_UNVERIFIED": ("WARN", "판례 미확인 (부존재 단정 불가)", "원문을 확인하거나 [미확인]으로 표기한다"),
    "WARN_CITE_UNCERTAIN": ("WARN", "판례 생사 불확실", "후속 판결 전문을 확인한다"),
    "WARN_LAW_UNRESOLVED": ("WARN", "법령명 미확인", "정식 법령명을 확인한다"),
    "WARN_ALIAS_UNREGISTERED": ("WARN", "법제처 약칭 사전에 없는 약칭", "처음 나올 때 정식 법령명을 병기한다"),
    "WARN_UNCHECKED": ("WARN", "미검증", "수동으로 확인한다"),
    "ERROR_LOOKUP": ("ERROR", "조회 실패 (검증하지 못함)", "인증키·네트워크·요청 상한을 확인하고 다시 검증한다"),
    "EXCLUDED": ("SKIP", "법령 인용 아님 (문서 자체의 조항)", ""),
    "REPLACED": ("SKIP", "법령명을 문맥으로 특정해 다른 항목으로 재검증함", ""),
}

VERDICT_KO = {"PASS": "통과", "PASS_WITH_WARNINGS": "조건부 통과", "FAIL": "반려", "INCOMPLETE": "검증 미완료", "NO_CITATIONS": "인용 없음"}

SCOPE_GUIDE = ("원문에서 그 조문이 나온 문장을 읽는다. 문서 자체의 조항(계약서 제12조 등)이면 EXCLUDED, evidence는 input.md의 그 문장을 그대로 복사. "
               "같은 문단 앞 문장이 법령을 분명히 가리키면 '<법령명> 제N조(원문 제목)'로 고쳐 재검증 묶음(document-2)에 넣고 REPLACED. "
               "어느 법령인지 문맥으로도 정할 수 없으면 WARN_UNCHECKED")


def _compact(s: str) -> str:
    return re.sub(r"\s+", "", s or "")


def is_alias_shaped(name: str) -> bool:
    """'외감법'처럼 공백 없는 짧은 약칭 꼴인지 본다. '외감법 시행령'도 약칭 꼴이다."""
    n = re.sub(r"\s+(?:시행령|시행규칙)$", "", (name or "").strip())
    return bool(n) and " " not in n and len(n) <= 8 and n.endswith("법") and "관한" not in n


# ---------------------------------------------------------------- init

def cmd_init(a: argparse.Namespace) -> None:
    src = Path(a.input)
    text = src.read_text(encoding="utf-8")
    if a.dir:
        out = Path(a.dir)
    else:
        root = Path(a.root)
        root.mkdir(parents=True, exist_ok=True)
        stamp = dt.date.today().strftime("%Y%m%d")
        n = 1
        while (root / f"{stamp}_{n:02d}").exists():
            n += 1
        out = root / f"{stamp}_{n:02d}"
    (out / "raw").mkdir(parents=True, exist_ok=True)
    (out / "input.md").write_text(text, encoding="utf-8")
    meta = {"source": str(src), "base_date": a.date, "created": dt.datetime.now().isoformat(timespec="seconds")}
    (out / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"run_dir": str(out), "chars": len(text), "base_date": a.date}, ensure_ascii=False, indent=2))


# ---------------------------------------------------------------- parse

def cmd_parse(a: argparse.Namespace) -> None:
    """document-1.json은 문서 전체, document-2.json부터는 재검증 묶음이다. 재검증 묶음에서는 이미 있는 조문·판례를 다시 세지 않는다."""
    run = Path(a.run_dir)
    docs = sorted((f for f in (run / "raw").glob("document-*.json") if re.fullmatch(r"document-\d+\.json", f.name)),
                  key=lambda f: int(re.search(r"\d+", f.name).group()))
    if not docs:
        sys.exit("raw/document-*.json이 없다. verify_document 응답의 JSON 블록을 먼저 저장한다")
    items: list[dict] = []
    seen: set[str] = set()
    counters = {"law": 0, "case": 0}
    changes: list[dict] = []
    for p in docs:
        ev = json.loads(p.read_text(encoding="utf-8"))
        if ev.get("schema") != SCHEMA:
            sys.exit(f"{p.name}: schema가 {SCHEMA}가 아니다")
        if p == docs[0]:
            changes = ev.get("normalize_changes", [])
        for it in ev["items"]:
            it = dict(it)
            # 첫 문서 안에서는 엔진이 이미 항목을 나눴다. 약칭과 정식명이 같은 조문을 가리켜도 둘 다 남긴다
            k = f"{p.name}|{it['id']}" if p == docs[0] else ("case|" + it.get("case_no", "") if it["kind"] == "case"
                 else "law|" + _compact(it.get("cited_law") or it.get("law", "")) + "|" + it.get("article", ""))
            if k in seen:
                continue
            seen.add(k)
            counters[it["kind"]] += 1
            it["id"] = f"{'L' if it['kind'] == 'law' else 'C'}{counters[it['kind']]}"
            it["checks"] = ["SCOPE_CHECK"] if it.get("needs_context") else []
            # 엔진이 앞 법령에서 법령명을 추정한 항목. 확인은 의무가 아니지만, 원문과 다르면 SCOPE_CHECK로 바로잡을 수 있다
            if any(e.get("check") == "LAW_INFERRED" for e in it.get("evidence", [])):
                it["optional_checks"] = ["SCOPE_CHECK"]
            items.append(it)
    (run / "items.json").write_text(json.dumps({"items": items, "normalize_changes": changes}, ensure_ascii=False, indent=2),
                                    encoding="utf-8")
    print(f"항목 {len(items)}개 (법령 {counters['law']}, 판례 {counters['case']}) → {run / 'items.json'}")
    scope = [it for it in items if it["checks"]]
    print("\n문맥 확인 목록 (overrides.json에 결과를 기록한다)")
    for it in scope:
        print(f"- {it['id']} SCOPE_CHECK   {it['cited']}")
    if not scope:
        print("- 없음. overrides.json은 빈 배열 []로 만든다")
    else:
        print(f"\n확인 방법\n- SCOPE_CHECK: {SCOPE_GUIDE}")
    guessed = [it for it in items if it.get("optional_checks")]
    if guessed:
        print("\n엔진이 법령명을 추정한 항목 (원문과 맞는지 훑어본다. 틀렸을 때만 SCOPE_CHECK로 기록한다)")
        for it in guessed:
            print(f"- {it['id']} {it['cited']}  ← {it['evidence'][0]['evidence']}")
    errors = [it for it in items if it.get("status") == "ERROR_LOOKUP"]
    if errors:
        print(f"\n[주의] 조회 실패 {len(errors)}건. 인증키·네트워크·요청 상한을 확인하고 verify_document를 다시 돌린다")


# ---------------------------------------------------------------- build

def load_overrides(path: Path) -> list[dict]:
    if not path.exists():
        return []
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, list):
        sys.exit("overrides.json은 배열이어야 한다")
    for i, o in enumerate(data):
        if o.get("status") not in STATUS:
            sys.exit(f"overrides[{i}] status가 잘못됐다: {o.get('status')}")
        if not str(o.get("evidence", "")).strip():
            sys.exit(f"overrides[{i}] evidence가 비었다. 판정 근거가 된 원문 문장이나 도구 결과 한 줄을 그대로 적는다")
        if not o.get("id"):
            sys.exit(f"overrides[{i}] id가 없다")
    return data


def compute_verdict(items: list[dict], pending: list[dict]) -> tuple[str, list[str]]:
    items = [it for it in items if STATUS[it["status"]][0] != "SKIP"]
    if not items:
        return "NO_CITATIONS", ["검증할 인용이 없다. 통과가 아니라 '검증할 것이 없음'이다"]
    classes = [STATUS[it["status"]][0] for it in items]
    if "FAIL" in classes:
        extra = [f"조회 실패 {classes.count('ERROR')}건은 검증하지 못했다. 고친 뒤 다시 검증한다"] if "ERROR" in classes else []
        return "FAIL", [f"FAIL {classes.count('FAIL')}건. 점수와 무관하게 반려한다"] + extra
    if "ERROR" in classes:
        # 검증하지 못한 인용을 경고로 덮으면 게이트가 열린다. 통과 계열 판정을 내지 않는다
        return "INCOMPLETE", [f"조회 실패 {classes.count('ERROR')}건. 검증을 끝내지 못했다. 인증키·네트워크·요청 상한을 확인하고 다시 돌린다"]
    reasons: list[str] = []
    if "WARN" in classes:
        reasons.append(f"WARN {classes.count('WARN')}건. 경고를 본문에 반영해야 통과한다")
    if pending:
        reasons.append(f"끝내지 않은 문맥 확인 {len(pending)}건. 모든 확인을 마치기 전에는 PASS를 주지 않는다")
    return ("PASS_WITH_WARNINGS" if reasons else "PASS"), reasons


def cmd_build(a: argparse.Namespace) -> None:
    run = Path(a.run_dir)
    meta = json.loads((run / "meta.json").read_text(encoding="utf-8"))
    data = json.loads((run / "items.json").read_text(encoding="utf-8"))
    items: list[dict] = data["items"]
    by_id = {it["id"]: it for it in items}
    source_text = (run / "input.md").read_text(encoding="utf-8")
    stale: list[str] = []
    done: dict[str, set] = {it["id"]: set() for it in items}
    for o in load_overrides(run / "overrides.json"):
        it = by_id.get(o["id"])
        if it is None:  # 재검증 묶음으로도 검증하지 못해 손으로 추가한 항목
            if o.get("kind") not in ("law", "case") or not o.get("cited"):
                sys.exit(f"새 항목 {o['id']}에는 kind(law|case)와 cited가 필요하다")
            it = {"id": o["id"], "kind": o["kind"], "cited": o["cited"], "law": o.get("law", ""),
                  "article": o.get("article", ""), "case_no": o.get("case_no", o["cited"]),
                  "status": o["status"], "checks": [], "source_line": "(엔진 미검출, 수동 추가)", "added": True}
            items.append(it)
            by_id[it["id"]] = it
            done[it["id"]] = set()
        chk = o.get("check")
        if chk and chk != "MANUAL" and chk not in it.get("checks", []) + it.get("optional_checks", []) and not it.get("added"):
            # parse가 요구하지 않은 확인 기록이다. 낡은 기록일 수 있으니 판정에 쓰지 않는다
            stale.append(f"{o['id']} {chk}")
            continue
        status = o["status"]
        if status == "FAIL_LAW_NOT_FOUND" and any(is_alias_shaped(c) for c in (it.get("law_candidates") or [it.get("law", "")])):
            status = "WARN_ALIAS_UNREGISTERED"  # 약칭 사전에 없을 뿐 실존 법령일 수 있다. 부존재 단정 금지
        if status == "EXCLUDED" and _compact(o["evidence"]) not in _compact(source_text):
            sys.exit(f"overrides {o['id']}: EXCLUDED의 evidence는 input.md 문장을 그대로 복사해야 한다")
        if status == "REPLACED":
            target = by_id.get(o.get("replaced_by", ""))
            if not target or _compact(target.get("article", "")) != _compact(it.get("article", "")):
                sys.exit(f"overrides {o['id']}: REPLACED에는 같은 조문을 재검증한 항목 id를 replaced_by로 적어야 한다")
        it["status"] = status
        it.setdefault("evidence", []).append({"check": chk or "MANUAL", "evidence": o["evidence"], "source": o.get("source", "")})
        it["fix"] = o.get("fix") or STATUS[status][2]  # 상태가 바뀌었으니 엔진이 붙인 안내도 바꾼다
        for k in ("law", "note", "replaced_by"):
            if o.get(k):
                it[k] = o[k]
        if chk:
            done[it["id"]].add(chk)
    pending = [{"id": it["id"], "check": c, "cited": it["cited"]}
               for it in items for c in it.get("checks", [])
               if c not in done.get(it["id"], set()) and STATUS[it["status"]][0] not in ("FAIL", "SKIP")]
    for it in items:
        cls, label, fix = STATUS[it["status"]]
        it["class"], it["reason"] = cls, label
        it.setdefault("fix", fix)
    verdict, reasons = compute_verdict(items, pending)
    if stale:
        reasons.append(f"parse가 요구하지 않은 확인 기록 {len(stale)}건을 무시했다: {', '.join(stale)}")

    def count(kind: str) -> dict:
        sub = [it for it in items if it["kind"] == kind]
        return {"total": len(sub), **{c: sum(1 for it in sub if it["class"] == c) for c in ("PASS", "WARN", "FAIL", "ERROR", "SKIP")}}

    ev = {
        "schema": SCHEMA,
        "verdict": verdict,
        "verdict_ko": VERDICT_KO[verdict],
        "reasons": reasons,
        "checked_at": dt.date.today().isoformat(),
        "base_date": meta.get("base_date"),
        "input": meta.get("source"),
        "normalize_changes": data.get("normalize_changes", []),
        "counts": {"law": count("law"), "case": count("case")},
        "items": items,
        "pending_checks": pending,
        "data_source": "법제처 국가법령정보센터 Open API (korean-law 엔진)",
    }
    (run / "evidence.json").write_text(json.dumps(ev, ensure_ascii=False, indent=2), encoding="utf-8")
    (run / "evidence.md").write_text(render_md(ev), encoding="utf-8")
    print(f"판정: {verdict} ({VERDICT_KO[verdict]})")
    for r in ev["reasons"]:
        print(f"- {r}")
    print(f"→ {run / 'evidence.md'}")


def _cell(s) -> str:
    return str(s or "").replace("|", "\\|").replace("\n", " ")


def _count_line(k: dict) -> str:
    err = f", 조회 실패 {k['ERROR']}" if k.get("ERROR") else ""
    return f"{k['total']}건 (통과 {k['PASS']}, 경고 {k['WARN']}, 실패 {k['FAIL']}{err})"


def render_md(ev: dict) -> str:
    c = ev["counts"]
    out = [
        "# 법률 근거 검증표",
        "",
        f"- 판정: **{ev['verdict']} ({ev['verdict_ko']})**",
        f"- 확인일: {ev['checked_at']}" + (f" · 기준일: {ev['base_date']}" if ev.get("base_date") else ""),
        f"- 법령 인용 {_count_line(c['law'])} · 판례 인용 {_count_line(c['case'])}",
    ]
    out += [f"- {r}" for r in ev["reasons"]]
    out.append("")
    groups = [("ERROR", "조회 실패 (검증하지 못함)"), ("FAIL", "반려 사유"), ("WARN", "경고"), ("PASS", "통과"),
              ("SKIP", "판정에서 뺀 항목 (문서 자체 조항, 재검증으로 대체)")]
    for cls, title in groups:
        rows = [it for it in ev["items"] if it["class"] == cls]
        if not rows:
            continue
        out += [f"## {title} ({len(rows)})", ""]
        if cls in ("PASS", "SKIP"):
            out += ["| # | 인용 | 판정 |", "|---|---|---|"]
            out += [f"| {it['id']} | {_cell(it['cited'])} | {_cell(it['reason'])} |" for it in rows]
        else:
            out += ["| # | 인용 | 판정 | 근거 | 고칠 곳 |", "|---|---|---|---|---|"]
            for it in rows:
                basis = it["evidence"][-1]["evidence"] if it.get("evidence") else it.get("source_line", "")
                if it.get("note"):
                    basis = f"{basis} (참고: {it['note']})"
                out.append(f"| {it['id']} | {_cell(it['cited'])} | {_cell(it['reason'])} | {_cell(basis)} | {_cell(it['fix'])} |")
        out.append("")
    if ev["pending_checks"]:
        out += ["## 끝내지 않은 문맥 확인", ""]
        out += [f"- {p['id']} {p['check']}: {p['cited']}" for p in ev["pending_checks"]]
        out.append("")
    if ev["normalize_changes"]:
        out += ["## 표기 정규화", "", "검증 전에 다음 표기를 바꿨다.", ""]
        out += [f"- `{ch['before']}` → `{ch['after']}`" for ch in ev["normalize_changes"]]
        out.append("")
    out += [
        "---",
        "",
        "출처: 법제처 국가법령정보센터 Open API. 이 표는 인용의 실존과 현행 여부를 확인한 것이며 법률 자문이 아니다. "
        "법적 효력이 필요한 판단은 국가법령정보센터 원문을 확인한다. 판례 '미확인'은 부존재를 뜻하지 않는다.",
        "",
    ]
    return "\n".join(out)


# ---------------------------------------------------------------- score

def match_item(exp: dict, items: list[dict]) -> dict | None:
    if exp["kind"] == "case":
        return next((it for it in items if it["kind"] == "case" and _compact(it.get("case_no", it["cited"])) == _compact(exp["cited"])), None)
    law, art = _compact(exp["law"]), _compact(exp["article"])
    cands = [it for it in items if it["kind"] == "law" and _compact(it.get("article", "")) == art]
    for it in cands:
        for il in (_compact(it.get("law", "")), _compact(it.get("cited_law", ""))):
            if il and (il == law or il in law or law in il):
                return it
    return next((it for it in cands if not _compact(it.get("law", ""))), None)


def cmd_score(a: argparse.Namespace) -> None:
    seeds = json.loads(Path(a.seeds).read_text(encoding="utf-8"))
    runs = Path(a.runs)
    rows, misses = [], []
    st = dict.fromkeys(("real", "real_ok", "real_false_fail", "fake", "fake_caught", "strict", "strict_fail", "missed", "docs", "doc_ok"), 0)
    for s in seeds["seeds"]:
        evp = runs / s["id"] / "evidence.json"
        if not evp.exists():
            misses.append(f"{s['id']}: evidence.json 없음")
            continue
        ev = json.loads(evp.read_text(encoding="utf-8"))
        st["docs"] += 1
        exp_doc, got_doc = s["expect_verdict"], ev["verdict"]
        st["doc_ok"] += got_doc == exp_doc or (exp_doc == "NOT_PASS" and got_doc != "PASS")
        for e in s["citations"]:
            it = match_item(e, ev["items"])
            cls = it["class"] if it else "MISSED"
            st["missed"] += it is None
            good = {"OK": cls == "PASS", "FAIL": cls == "FAIL", "WARN": cls == "WARN", "NOT_OK": cls in ("WARN", "FAIL")}[e["expect"]]
            if e["truth"] in ("real", "legit_old"):  # 의도적 구법 인용도 정당한 인용이다. FAIL이면 오탐으로 센다
                st["real"] += 1
                st["real_ok"] += good
                st["real_false_fail"] += cls == "FAIL"
            else:
                st["fake"] += 1
                st["fake_caught"] += cls in ("WARN", "FAIL")
                if e["expect"] == "FAIL":
                    st["strict"] += 1
                    st["strict_fail"] += cls == "FAIL"
            rows.append((s["id"], e.get("type", ""), e["cited"], e["truth"], e["expect"], it["status"] if it else "-", "O" if good else "X"))
    pct = lambda n, d: f"{(100 * n / d):.0f}%" if d else "-"
    lines = [
        "# 시드 평가 결과", "",
        f"실행일 {dt.date.today().isoformat()} · 기준일 {seeds.get('as_of', '-')} · 문서 {st['docs']}개", "",
        "| 지표 | 결과 | 기준 |", "|---|---|---|",
        f"| 진짜 인용을 FAIL로 판정 (오탐) | {st['real_false_fail']}건 / {st['real']} | 0건 |",
        f"| 정당한 인용의 기대 판정 적중률 | {pct(st['real_ok'], st['real'])} | 참고 |",
        f"| 가짜·낡은 인용 검출률 (WARN 또는 FAIL) | {pct(st['fake_caught'], st['fake'])} ({st['fake_caught']}/{st['fake']}) | 90% 이상 |",
        f"| FAIL이어야 하는 유형의 FAIL 판정률 | {pct(st['strict_fail'], st['strict'])} ({st['strict_fail']}/{st['strict']}) | 100% |",
        f"| 미검출 인용 | {st['missed']}건 | 0건 |",
        f"| 문서 판정 일치 | {st['doc_ok']}/{st['docs']} | 전부 |",
        "", "## 인용별", "",
        "| 시드 | 유형 | 인용 | 정답 | 기대 | 결과 | 적중 |", "|---|---|---|---|---|---|---|",
    ]
    lines += [f"| {r[0]} | {r[1]} | {_cell(r[2])} | {r[3]} | {r[4]} | {r[5]} | {r[6]} |" for r in rows]
    if misses:
        lines += ["", "## 실행 누락", ""] + [f"- {m}" for m in misses]
    report = "\n".join(lines) + "\n"
    if a.out:
        Path(a.out).write_text(report, encoding="utf-8")
    print(report)


# ---------------------------------------------------------------- main

def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sp = p.add_subparsers(dest="cmd", required=True)
    i = sp.add_parser("init", help="실행 폴더 생성")
    i.add_argument("input")
    i.add_argument("--root", default="output")
    i.add_argument("--dir", help="실행 폴더를 직접 지정 (평가용)")
    i.add_argument("--date", help="기준일 YYYY-MM-DD (행위·계약 시점)")
    i.set_defaults(fn=cmd_init)
    q = sp.add_parser("parse", help="verify_document 판정 JSON 모으기")
    q.add_argument("run_dir")
    q.set_defaults(fn=cmd_parse)
    b = sp.add_parser("build", help="최종 판정과 검증표 생성")
    b.add_argument("run_dir")
    b.set_defaults(fn=cmd_build)
    s = sp.add_parser("score", help="시드 평가 채점")
    s.add_argument("seeds")
    s.add_argument("runs")
    s.add_argument("--out")
    s.set_defaults(fn=cmd_score)
    a = p.parse_args()
    a.fn(a)


if __name__ == "__main__":
    main()
