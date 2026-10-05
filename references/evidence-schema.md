# 출력 형식

## 실행 폴더

```
output/{YYYYMMDD}_NN/
├── input.md              원문
├── meta.json             원문 경로, 기준일
├── raw/document-N.json   verify_document 응답 JSON (수정 금지). 1은 문서 전체, 2부터는 재검증 묶음
├── items.json            모은 항목과 문맥 확인 목록
├── overrides.json        문맥 확인 결과 (LLM이 기록)
├── expert-review.json    전문가 3인 평가 (LLM이 기록, 참고용)
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
  "data_source": "법제처 국가법령정보센터 Open API",
  "expert_review": {"scene": "GOLD의 독자 장면", "reviews": [{"role": "RED | SILVER | GOLD", "score": 8.5, "comment": "평가 한 줄", "fix": "고칠 점 한 줄"}], "average": 8.5, "note": "참고용 평가. 판정에 영향을 주지 않는다 (build, 선택)"}
}
```

`@2`(2026-10-05)에서 바뀐 것: 판정 `INCOMPLETE`, 등급 `ERROR`와 상태 `ERROR_LOOKUP`, 엔진이 내는 `EXCLUDED`, 근거 `LAW_INFERRED`, 항목의 `optional_checks`, 선택 필드 `expert_review`(판정과 무관한 참고 평가). 스키마를 바꾸면 버전을 올리고, 이 문서와 결과를 읽는 쪽 코드를 함께 고친다.

## 다른 작업 흐름에 붙일 때

| 판정 | 할 일 |
|---|---|
| `FAIL` | 문서를 작성자(사람 또는 AI)에게 돌려보낸다. `evidence.md`의 반려 사유 표를 그대로 넘긴다. 고친 뒤 처음부터 다시 검증한다 |
| `INCOMPLETE` 또는 도구 오류 | 다음 단계로 넘기지 않는다. 한 번 다시 돌리고, 그래도 같으면 멈추고 사람에게 알린다 |
| `PASS_WITH_WARNINGS` | 경고를 본문에 반영하게 한 뒤 다음 단계로 넘긴다 |
| `PASS` | 다음 단계로 넘긴다. 검증표를 문서 끝에 붙여 근거로 남길 수 있다 |

`expert_review`의 점수는 참고 의견이다. 작업 흐름의 통과 조건에 쓰지 않는다.
