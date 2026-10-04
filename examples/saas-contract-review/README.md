# 예시: SaaS 이용계약 검토 메모

AI가 흔히 쓰는 형태의 계약서 검토 메모([input.md](input.md))에 실제로 자주 나오는 인용 오류를 섞어 korean-law를 돌린 결과다.

## 결과

**반려 (FAIL 2, WARN 2).** 검증표는 [run/evidence.md](run/evidence.md), 기계용 판정은 [run/evidence.json](run/evidence.json)이다. `verify_document` 한 번 호출에 약 2초가 걸렸다.

## 심어 둔 것과 잡힌 것

| 메모 속 인용 | 심어 둔 것 | 게이트 판정 |
|---|---|---|
| 정보통신망법 제22조(개인정보의 수집·이용 동의 등) | 2020년 데이터 3법 개정으로 **삭제된 조문** | ✗ `FAIL_DELETED` (제22조 삭제 <2020.2.4>) |
| 대법원 2015. 3. 26. 선고 2013다61381 | 실존 사건번호에 **다른 선고일**을 붙임 (실제는 2018. 10. 30. 강제징용 사건) | ✗ `FAIL_CASE_MISMATCH` |
| 전자상거래법 제17조(청약철회 기간) | 실제 제목은 '청약철회등' | ⚠ `WARN_TITLE_DIFF` |
| 대법원 2017다951234 | 지어낸 사건번호 | ⚠ `WARN_CASE_UNVERIFIED` (부존재로 단정하지 않는다) |
| 약관법 제7조, 제6조 | 문서 안에서 정의한 약칭 `(이하 '약관법')` | ✓ 정식 명칭으로 풀어 통과 |
| 민법 398조 | '제'가 빠진 표기 | ✓ 정규화 후 통과 |
| 개인정보 보호법 제17조 | 정상 인용 | ✓ 통과 |
| 본 약관 제11조(책임의 제한) | 법령이 아니라 검토 대상 약관 자체의 조항 | 엔진이 판정에서 제외 (`EXCLUDED`). 마지막 문단의 '제11조는'도 같은 조항으로 본다 |

진짜 인용 4건은 모두 통과했고, 심어 둔 오류 4건은 모두 걸렸다.

## 실행 폴더

| 파일 | 만든 단계 |
|---|---|
| `run/input.md`, `run/meta.json` | `kl.py init` |
| `run/raw/document-1.json` | `verify_document` 응답 |
| `run/items.json` | `kl.py parse` |
| `run/overrides.json` | 문맥 확인 결과. 이 예시는 엔진이 모두 정해 빈 배열 `[]`이다 |
| `run/evidence.json`, `run/evidence.md` | `kl.py build` |

## 다시 돌려 보기

저장소 루트에서, 인증키를 `mcp/.env`에 넣고 `mcp/`를 빌드한 뒤:

```bash
python3 scripts/kl.py init examples/saas-contract-review/input.md --dir /tmp/kl-example
```

```bash
node mcp/scripts/verify-file.mjs /tmp/kl-example/input.md > /tmp/kl-example/raw/document-1.json
```

```bash
python3 scripts/kl.py parse /tmp/kl-example
```

문맥 확인 목록이 '없음'이면 `overrides.json`을 `[]`로 만들고 마지막으로:

```bash
echo '[]' > /tmp/kl-example/overrides.json
```

```bash
python3 scripts/kl.py build /tmp/kl-example
```

Claude Code나 Codex에서는 "이 문서 법률 인용 검증해 줘"라고 하면 스킬이 이 단계를 진행한다.
