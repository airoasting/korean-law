# 시드 평가 결과

실행일 2026-10-04 · 기준일 2026-10-04 · 문서 24개

| 지표 | 결과 | 기준 |
|---|---|---|
| 진짜 인용을 FAIL로 판정 (오탐) | 0건 / 63 | 0건 |
| 정당한 인용의 기대 판정 적중률 | 100% | 참고 |
| 가짜·낡은 인용 검출률 (WARN 또는 FAIL) | 100% (23/23) | 90% 이상 |
| FAIL이어야 하는 유형의 FAIL 판정률 | 100% (17/17) | 100% |
| 미검출 인용 | 0건 | 0건 |
| 문서 판정 일치 | 23/24 | 전부 |

## 인용별

| 시드 | 유형 | 인용 | 정답 | 기대 | 결과 | 적중 |
|---|---|---|---|---|---|---|
| S01 |  | 민법 제750조 | real | OK | OK | O |
| S01 |  | 민법 제398조 | real | OK | OK | O |
| S01 |  | 근로기준법 제23조 | real | OK | OK | O |
| S01 | T1 | 근로기준법 제27조의5 | fake | FAIL | FAIL_NOT_FOUND | O |
| S01 |  | 2013다61381 | real | OK | OK | O |
| S01 | T3 | 2031다12345 | fake | FAIL | FAIL_IMPOSSIBLE_CASE | O |
| S01 |  | 개인정보 보호법 제15조 | real | OK | OK | O |
| S02 |  | 약관의 규제에 관한 법률 제6조 | real | OK | OK | O |
| S02 |  | 약관의 규제에 관한 법률 제7조 | real | OK | OK | O |
| S02 |  | 민법 제398조 | real | OK | OK | O |
| S02 | T1 | 민법 제1200조 | fake | FAIL | FAIL_NOT_FOUND | O |
| S03 |  | 근로기준법 제23조 | real | OK | OK | O |
| S03 |  | 근로기준법 제26조 | real | OK | OK | O |
| S03 |  | 근로기준법 제27조 | real | OK | OK | O |
| S03 |  | 근로기준법 제28조 | real | OK | OK | O |
| S03 | T2 | 근로기준법 제60조(해고의 예고) | fake | FAIL | FAIL_MISMATCH | O |
| S04 |  | 개인정보 보호법 제15조 | real | OK | OK | O |
| S04 |  | 개인정보 보호법 제17조 | real | OK | OK | O |
| S04 |  | 개인정보 보호법 제28조의2 | real | OK | OK | O |
| S04 | T1 | 개인정보 보호법 제99조 | fake | FAIL | FAIL_NOT_FOUND | O |
| S05 |  | 상법 제382조의3 | real | OK | OK | O |
| S05 |  | 상법 제399조 | real | OK | OK | O |
| S05 | T10 | 제401조 | real | OK | OK | O |
| S05 |  | 형법 제356조 | real | OK | OK_ALIAS | O |
| S05 | T3 | 2029도4567 | fake | FAIL | FAIL_IMPOSSIBLE_CASE | O |
| S06 | T13 | 구 증권거래법 제188조의2 | legit_old | WARN | WARN_REPEALED_HISTORICAL | O |
| S06 |  | 자본시장과 금융투자업에 관한 법률 제174조 | real | WARN | WARN_PENDING_CHANGE | O |
| S06 | T11 | 자본시장법 제174조 | real | WARN | WARN_PENDING_CHANGE | O |
| S07 | T5 | 간접투자자산 운용업법 제56조 | fake | FAIL | FAIL_REPEALED | O |
| S07 | T5 | 증권거래법 제188조의2 | fake | FAIL | FAIL_REPEALED | O |
| S07 |  | 민법 제750조 | real | OK | OK | O |
| S08 |  | 형법 제347조 | real | OK | OK | O |
| S08 | T2 | 형법 제355조(사기) | fake | FAIL | FAIL_MISMATCH | O |
| S08 | T4 | 2015다951234 | fake | NOT_OK | WARN_CASE_UNVERIFIED | O |
| S08 | T1 | 형법 제400조 | fake | FAIL | FAIL_NOT_FOUND | O |
| S09 | T6 | 2004도2965 | fake | FAIL | FAIL_OVERRULED | O |
| S09 |  | 2016도10912 | real | OK | OK | O |
| S09 |  | 2014도9867 | real | OK | OK | O |
| S10 | T6 | 2012다89399 | fake | NOT_OK | FAIL_OVERRULED | O |
| S10 |  | 근로기준법 제56조 | real | OK | OK | O |
| S11 |  | 국세기본법 제14조 | real | OK | OK | O |
| S11 |  | 법인세법 제52조 | real | OK | OK_ALIAS | O |
| S11 |  | 부가가치세법 제3조 | real | OK | OK | O |
| S11 | T2 | 소득세법 제20조(실질과세) | fake | FAIL | FAIL_MISMATCH | O |
| S12 |  | 주식회사 등의 외부감사에 관한 법률 제8조 | real | OK | OK | O |
| S12 | T11 | 외감법 제8조 | real | WARN | WARN_ALIAS_UNREGISTERED | O |
| S12 |  | 상법 제393조 | real | OK | OK | O |
| S12 | T9 | 임원 보수 공시에 관한 법률 제5조 | fake | FAIL | FAIL_LAW_NOT_FOUND | O |
| S13 |  | 중대재해 처벌 등에 관한 법률 제4조 | real | OK | OK | O |
| S13 | T11 | 중대재해처벌법 제4조 | real | OK | OK_ALIAS | O |
| S13 | T9 | 기업 이사회 운영에 관한 법률 제3조 | fake | FAIL | FAIL_LAW_NOT_FOUND | O |
| S14 | T8 | 형법 제241조 | fake | FAIL | FAIL_DELETED | O |
| S14 | T8 | 형법 제304조 | fake | FAIL | FAIL_DELETED | O |
| S14 | T12 | 2009헌바17 | real | OK | OK | O |
| S15 | T12 | 2004헌마554 | real | OK | OK | O |
| S15 | T4 | 2019도987654 | fake | NOT_OK | WARN_CASE_UNVERIFIED | O |
| S16 | T11 | 공정거래법 제45조 | real | OK | OK_ALIAS | O |
| S16 |  | 하도급거래 공정화에 관한 법률 제4조 | real | OK | OK | O |
| S16 |  | 독점규제 및 공정거래에 관한 법률 제45조 | real | OK | OK_ALIAS | O |
| S17 | T10 | 민법 750조 | real | OK | OK | O |
| S17 | T10 | 민법 §398 | real | OK | OK | O |
| S17 | T10 | 근로기준법 23조 1항 | real | OK | OK | O |
| S17 |  | 민법 제390조 | real | OK | OK | O |
| S17 | T10 | 제103조 | real | OK | OK | O |
| S18 | T7 | 전자거래기본법 제4조 | fake | NOT_OK | WARN_RENAMED | O |
| S18 | T7 | 정신보건법 제24조 | fake | NOT_OK | WARN_RENAMED | O |
| S19 |  | 주택임대차보호법 제3조 | real | OK | OK | O |
| S19 |  | 상가건물 임대차보호법 제10조 | real | OK | OK | O |
| S19 |  | 민법 제543조 | real | OK | OK | O |
| S19 | T4 | 2017두951111 | fake | NOT_OK | WARN_CASE_UNVERIFIED | O |
| S20 |  | 민사소송법 제249조 | real | OK | OK | O |
| S20 |  | 민법 제2조 | real | OK | OK | O |
| S20 |  | 민법 제103조 | real | OK | OK | O |
| S20 |  | 민법 제390조 | real | OK | OK | O |
| S20 |  | 2013다61381 | real | OK | OK | O |
| S20 |  | 2008다38288 | real | OK | OK | O |
| S21 |  | 민법 제398조 | real | OK | OK | O |
| S21 |  | 약관의 규제에 관한 법률 제7조 | real | OK | OK | O |
| S22 | T14 | 2002두12052 | fake | FAIL | FAIL_CASE_MISMATCH | O |
| S22 |  | 2013다61381 | real | OK | OK | O |
| S23 |  | 주식회사 등의 외부감사에 관한 법률 제8조 | real | OK | OK | O |
| S23 | T11 | 중처법 제4조 | real | OK | OK | O |
| S24 | T15 | 근로기준법 제105조 | real | WARN | WARN_PENDING_CHANGE | O |
| S24 | T15 | 근로기준법 제109조 | real | WARN | WARN_PENDING_CHANGE | O |
| S24 |  | 근로기준법 제23조 | real | OK | OK | O |
| S24 | T15 | 근로기준법 제44조의4 | real | WARN | WARN_NOT_YET_EFFECTIVE | O |
