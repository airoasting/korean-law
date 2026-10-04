# 출력 형식과 Roasting 연동 계약

## 실행 폴더

```
output/{YYYYMMDD}_NN/
├── input.md              원문
├── meta.json             원문 경로, 기준일
├── raw/document-N.json   verify_document 응답 JSON (수정 금지). 1은 문서 전체, 2부터는 재검증 묶음
├── items.json            모은 항목과 문맥 확인 목록
├── overrides.json        문맥 확인 결과 (LLM이 기록)
├── evidence.json         최종 판정 (기계용, 아래 스키마)
└── evidence.md           법률 근거 검증표 (사람용)
```

## evidence.json (`korean-law/evidence@2`)

`verify_document`의 응답 JSON과 `kl.py build`의 결과는 같은 스키마다. `build`는 문맥 확인을 반영하고 `counts`, `input`, `base_date`를 더한다.

```json
{
  "schema": "korean-law/evidence@2",
  "verdict": "FAIL | INCOMPLETE | PASS_WITH_WARNINGS | PASS | NO_CITATIONS",
  "verdict_ko": "반려 | 검증 미완료 | 조건부 통과 | 통과 | 인용 없음",
  "reasons": ["판정 이유와 주의 사항"],
  "checked_at": "YYYY-MM-DD",
  "base_date": "YYYY-MM-DD 또는 null (build)",
  "as_of": "YYYYMMDD 또는 null (verify_document)",
  "input": "원문 경로 (build)",
  "normalize_changes": [{"rule": "...", "before": "...", "after": "..."}],
  "counts": {"law": {"total": 0, "PASS": 0, "WARN": 0, "FAIL": 0, "ERROR": 0, "SKIP": 0}, "case": {"...": "같은 형식"}},
  "items": [
    {
      "id": "L1 | C1 | M1",
      "kind": "law | case",
      "cited": "정식 법령명 + 조문·항·호·목 (law) 또는 사건번호 (case)",
      "law": "정식 법령명", "cited_law": "문서에 적힌 법령명", "article": "제N조(의M)",
      "title": "실제 조문 제목", "claimed_title": "문서에 적힌 제목",
      "case_no": "사건번호 (case)",
      "status": "verdict-rules.md의 상태",
      "class": "PASS | WARN | FAIL | ERROR | SKIP",
      "reason": "상태 설명",
      "fix": "고칠 곳",
      "source_line": "문서에서 잡은 인용 원문",
      "evidence": [{"check": "ARTICLE_CHECK", "evidence": "법제처 응답 한 줄", "source": "조회한 API와 키"}],
      "needs_context": "true면 문맥 확인 대상",
      "law_candidates": ["문맥 확인용 법령명 후보"],
      "optional_checks": ["SCOPE_CHECK (build: 엔진이 법령명을 추정한 항목)"]
    }
  ],
  "pending_checks": ["끝내지 않은 확인 (verify_document는 id 목록, build는 {id, check, cited})"],
  "data_source": "법제처 국가법령정보센터 Open API"
}
```

`@2`(2026-10-05)에서 바뀐 것: 판정 `INCOMPLETE`, 등급 `ERROR`와 상태 `ERROR_LOOKUP`, 엔진이 내는 `EXCLUDED`, 근거 `LAW_INFERRED`, 항목의 `optional_checks`. 스키마를 바꾸면 버전을 올리고, 이 문서와 Roasting 쪽 소비 코드를 함께 고친다.

## Roasting 연동 계약 (Step 3에서 구현)

| 시점 | Roasting이 할 일 | 이 스킬이 주는 것 |
|---|---|---|
| BLACK 초안 직후 (Phase 4.5) | 초안 파일을 이 스킬에 넣는다. 케이스에 기준일이 있으면 `--date`와 `asOf`로 넘긴다 | `evidence.json`, `evidence.md` |
| `verdict == INCOMPLETE` 또는 도구 오류 | 비평 단계로 가지 않는다. 한 번 다시 돌리고, 그래도 같으면 멈추고 사용자에게 보고한다 | 조회 실패 목록 |
| `verdict == FAIL` | 비평 단계로 가지 않는다. `evidence.md`의 반려 사유를 BLACK 재작성 프롬프트에 붙인다. 라운드 상한(4)에 포함한다 | 반려 사유와 고칠 곳 |
| 게이트가 2번 연속 FAIL | 멈추고 사용자에게 보고한다 | |
| `PASS` 또는 `PASS_WITH_WARNINGS` | `evidence.md`를 SILVER 프롬프트에 1차 출처로 붙인다. SILVER 평가축에 "경고를 본문에 반영했는가"를 더한다 | 경고 목록 |
| 최종 산출물 | `evidence.md`의 표를 문서 끝에 붙인다 | 검증표 |

비평가 에이전트(`tools: ["Read"]`)에게 MCP 권한을 주지 않는다. 게이트는 오케스트레이터가 실행하고, 비평가는 결과 파일만 읽는다.
