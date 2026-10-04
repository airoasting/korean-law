# korean-law MCP 서버

법률 문서의 조문·판례 인용을 법제처 국가법령정보센터 Open API로 검증하는 MCP 서버(stdio)다. 저장소 루트의 korean-law 스킬이 이 서버를 엔진으로 쓴다. 설치와 등록은 [루트 README](../README.md#설치)에 있다.

## 빌드와 테스트

```bash
npm ci && npm run build
```

```bash
npm test
```

테스트는 법제처를 부르지 않는다. 실제 API 회귀는 루트의 `evals/`에서 돌린다.

## 설정 (`.env`)

| 이름 | 뜻 | 기본 |
|---|---|---|
| `KOREAN_LAW_OC` | 법제처 Open API 인증키 | 없음 (필수) |
| `KOREAN_LAW_MAX_REQUESTS` | 도구 호출 한 번이 쓸 수 있는 법제처 요청 수 | 400 |

`.env`는 git에 올라가지 않는다. 응답과 오류 메시지에서 인증키는 가려진다.

## 구조

| 파일 | 하는 일 |
|---|---|
| `src/server.ts` | 도구 6개 등록, 요청 상한, 응답 길이 제한 |
| `src/tools.ts` | 도구별 처리와 출력 |
| `src/verify.ts` | `verify_document`. 조문(항·호·목)·판례 검증, 생략 법령명 추정의 신뢰 규칙, 판정 |
| `src/normalize.ts` | 표기 정규화 (`750조`, `§398`, `1항`, 이어진 조문, 약칭 정의) |
| `src/citations.ts` | 조문 인용 추출 (법령명, 같은 법, 생략 법령명 추정, 문서 자체 조항, 항·호·목, 인용 제목) |
| `src/cases.ts` | 사건번호 추출과 판례·헌재 결정 조회 |
| `src/citator.ts` | 판례 생사 (후속 판결 본문의 변경 문구) |
| `src/laws.ts` | 법령 검색, 연혁, 기준일 버전, 조문 조회 |
| `src/aliases.ts`, `src/alias-data.ts`, `src/alias-informal.ts` | 약칭 해소 (법제처 공식 약칭 2,542건과 통칭) |
| `src/title-match.ts` | 인용 제목과 실제 제목 대조 |
| `src/verdict.ts` | 상태 표와 문서 판정 |
| `src/render.ts` | 검증표 마크다운 |
| `src/http.ts` | 법제처 API 클라이언트 (캐시, 재시도, 요청 상한, 인증키 가림) |
| `src/jo.ts` | 조문 번호 코드 변환 |
| `scripts/verify-file.mjs` | MCP 없이 파일 하나를 검증해 판정 JSON 출력 (인증키 없음은 종료 코드 2, 검증 미완료는 3) |
| `scripts/build-law-aliases.mjs` | 법제처에서 공식 약칭을 다시 모아 `src/alias-data.ts` 갱신 (`npm run aliases`) |

## 갱신 기준

- 법제처가 약칭을 새로 정하면 `npm run aliases`로 사전을 다시 만든다.
- 판정 규칙을 바꾸면 `src/verdict.ts`, 스킬의 `scripts/kl.py`, `references/verdict-rules.md`를 함께 고친다.
