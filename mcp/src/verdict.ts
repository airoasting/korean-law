/**
 * 판정 규칙 (스킬 scripts/kl.py STATUS·compute_verdict와 같은 규칙).
 * 상태 목록과 문서 판정의 정본은 스킬 references/verdict-rules.md 다. 둘이 어긋나면 그 문서와 맞춘다.
 */

import { reEscape } from "./text.js"

export type GateClass = "PASS" | "WARN" | "FAIL" | "SKIP" | "ERROR"

export const GATE_STATUS = {
  OK: ["PASS", "실존 확인", ""],
  OK_ALIAS: ["PASS", "약칭, 정식 법령에서 확인", "처음 나올 때 정식 법령명을 병기한다"],
  FAIL_NOT_FOUND: ["FAIL", "조문 없음", "올바른 조문 번호를 찾아 고치거나 인용을 뺀다"],
  FAIL_MISMATCH: ["FAIL", "조문 제목 불일치", "조문 번호와 제목 중 무엇이 맞는지 확인해 고친다"],
  FAIL_LAW_NOT_FOUND: ["FAIL", "법령 부존재", "실제 법령을 찾아 바꾸거나 인용을 뺀다"],
  FAIL_IMPOSSIBLE_CASE: ["FAIL", "실존 불가 사건번호", "판례 인용을 빼거나 실제 사건번호로 바꾼다"],
  FAIL_CASE_MISMATCH: ["FAIL", "사건번호는 실존하나 인용한 선고일과 다름", "실제 판례를 찾아 사건번호와 선고일을 바로잡거나 인용을 뺀다"],
  FAIL_REPEALED: ["FAIL", "폐지 법령을 현행처럼 인용", "후속 법령으로 바꾸거나 '구 ○○법'과 적용 시점을 명시한다"],
  FAIL_DELETED: ["FAIL", "삭제된 조문", "삭제 사실을 반영해 고치거나 인용을 뺀다"],
  FAIL_OVERRULED: ["FAIL", "변경·폐기된 판례", "변경한 후속 판결을 인용하거나 변경 사실을 명시한다"],
  WARN_RENAMED: ["WARN", "옛 법령명", "현행 법령명으로 고치고 조문 번호를 다시 확인한다"],
  WARN_TITLE_DIFF: ["WARN", "인용한 조문 제목이 실제 제목과 다름 (엔진은 일치로 봄)", "조문 제목을 실제 제목으로 고친다"],
  WARN_NOT_YET_EFFECTIVE: ["WARN", "아직 시행되지 않은 신설 조문·항 (공포됐으나 시행 전)", "시행일을 명시하거나, 현재 적용 조문으로 쓰지 않는다"],
  WARN_PENDING_CHANGE: ["WARN", "현재 유효하나 시행 예정 개정이 있음 (조문이 바뀌거나 삭제될 예정)", "시행일 전후 어느 조문을 적용하는지 명시한다"],
  WARN_REPEALED_HISTORICAL: ["WARN", "구법 인용, 적용 시점 확인 필요", "행위 시점이 구법 시행 기간인지 본문에 명시한다"],
  WARN_CASE_UNVERIFIED: ["WARN", "판례 미확인 (부존재 단정 불가)", "원문을 확인하거나 [미확인]으로 표기한다"],
  WARN_CITE_UNCERTAIN: ["WARN", "판례 생사 불확실", "후속 판결 전문을 확인한다"],
  WARN_LAW_UNRESOLVED: ["WARN", "법령명 미확인", "정식 법령명을 확인한다"],
  WARN_ALIAS_UNREGISTERED: ["WARN", "법제처 약칭 사전에 없는 약칭", "처음 나올 때 정식 법령명을 병기한다"],
  WARN_UNCHECKED: ["WARN", "미검증", "수동으로 확인한다"],
  ERROR_LOOKUP: ["ERROR", "조회 실패 (검증하지 못함)", "인증키·네트워크·요청 상한을 확인하고 다시 검증한다"],
  EXCLUDED: ["SKIP", "법령 인용 아님 (문서 자체의 조항)", ""],
  REPLACED: ["SKIP", "법령명을 문맥으로 특정해 다른 항목으로 재검증함", ""],
} as const satisfies Record<string, readonly [GateClass, string, string]>

export type GateStatus = keyof typeof GATE_STATUS
export type GateVerdict = "PASS" | "PASS_WITH_WARNINGS" | "FAIL" | "INCOMPLETE" | "NO_CITATIONS"
export const VERDICT_KO: Record<GateVerdict, string> = {
  PASS: "통과", PASS_WITH_WARNINGS: "조건부 통과", FAIL: "반려", INCOMPLETE: "검증 미완료", NO_CITATIONS: "인용 없음",
}

export interface GateItem {
  id: string
  kind: "law" | "case"
  cited: string
  law?: string
  /** 문서에 적힌 법령명 (약칭 해소 전) */
  cited_law?: string
  article?: string
  title?: string
  claimed_title?: string
  case_no?: string
  status: GateStatus
  class: GateClass
  reason: string
  fix: string
  source_line: string
  evidence: Array<{ check: string; evidence: string; source: string }>
  /** 문맥으로 법령명을 정해야 하는 항목 (스킬의 SCOPE_CHECK). verify_document 가 스스로 판정하지 않는다 */
  needs_context?: boolean
  law_candidates?: string[]
}

export function makeItem(base: Omit<GateItem, "class" | "reason" | "fix" | "evidence"> & { evidence?: GateItem["evidence"] }): GateItem {
  const [cls, reason, fix] = GATE_STATUS[base.status]
  return { evidence: [], ...base, class: cls, reason, fix }
}

/** 제목 비교 키: '등' 꼬리, 가운뎃점·'및', '삼'·'3', 공백 차이는 같은 제목으로 본다 (kl.py _title_key) */
export function titleKey(t: string): string {
  return t.trim().replace(/\s*등$/u, "").replace(/\s+및\s+/gu, "·").replace(/삼/gu, "3").replace(/[ㆍ·‧\s]/gu, "")
}

/** 조문 단위의 비교용 본문: 조문내용 + 항·호 내용. 공백과 개정 꼬리표(<개정 …>)는 뺀다 */
export function unitText(unit: Record<string, unknown> | undefined): string {
  if (!unit) return ""
  const parts: string[] = [String(unit.조문내용 ?? "")]
  const walk = (x: unknown) => {
    for (const node of ([] as unknown[]).concat(x ?? [])) {
      if (!node || typeof node !== "object") continue
      const n = node as Record<string, unknown>
      for (const k of ["항내용", "호내용", "목내용"]) if (n[k]) parts.push(String(n[k]))
      walk(n.호); walk(n.목)
    }
  }
  walk(unit.항)
  return parts.join(" ").replace(/<(?:개정|신설|전문개정|본조신설)[^>]{0,80}>/gu, "").replace(/\s+/gu, "")
}

/** 조문 전체가 삭제됐는가: 조문내용이 '제N조 삭제 <날짜>' 꼴이고 항이 없다. 항·호 일부 삭제는 아니다 */
export function isDeletedUnit(unit: Record<string, unknown> | undefined): boolean {
  if (!unit || unit.항) return false
  return /^제\d{1,4}조(?:의\d{1,3})?\s*(?:\([^)]{0,60}\))?\s*삭제\s*</u.test(String(unit.조문내용 ?? "").trim())
}

/** 본문이 '구 ○○법' 또는 '(구)○○법'으로 일부러 구법을 인용했는가 */
export function isHistoricalCitation(lawName: string, text: string): boolean {
  if (!lawName) return false
  const name = lawName.replace(/\s+/gu, "").split("").map(reEscape).join("\\s*")
  return new RegExp(`(?:(?<![가-힣])구|\\(구\\))\\s*${name}`, "u").test(text)
}

/** '외감법'처럼 공백 없는 짧은 약칭 꼴인가 ('외감법 시행령' 포함) */
export function isAliasShaped(name: string): boolean {
  const n = name.trim().replace(/\s+(?:시행령|시행규칙)$/u, "")
  return n !== "" && !/\s/u.test(n) && n.length <= 8 && n.endsWith("법") && !n.includes("관한")
}

/** '시행령 제89조', '호와 시행령'처럼 부모 법령이 빠진 시행령·시행규칙인가 */
export function isBareDecree(name: string): boolean {
  const toks = name.trim().split(/\s+/u)
  if (!toks.length || !/^(?:시행령|시행규칙)$/u.test(toks[toks.length - 1])) return false
  return !toks.slice(0, -1).some((t) => /(?:법|법률)$/u.test(t) && t !== "법" && t !== "동법")
}

// 법령명 끝에 오는 낱말과, 법령명 앞머리가 될 수 없는 관형·접속 낱말
const SUFFIX_TOKENS = new Set(["법", "법률", "시행령", "시행규칙", "규칙", "규정", "조례"])
const FRAGMENT_HEADS = new Set(["관한", "대한", "관하여", "대하여", "위한", "의한", "따른", "및", "또는", "등"])

/** 법령명 후보를 짧은 것부터. 정확매칭이 처음 나온 후보를 쓴다 (문장 조각이 붙은 법령명 대응) */
export function lawCandidates(name: string): string[] {
  const toks = name.trim().split(/\s+/u)
  const out: string[] = []
  for (let i = toks.length - 1; i >= 0; i--) {
    const cand = toks.slice(i).join(" ")
    if (SUFFIX_TOKENS.has(cand) || FRAGMENT_HEADS.has(toks[i])) continue
    out.push(cand)
  }
  return out
}

/** 본문에서 사건번호 바로 앞(40자 안)에 적힌 선고일들. 예: '대법원 2003. 7. 22. 선고 2002두12052' → 20030722 */
export function citedDates(caseNo: string, text: string): string[] {
  const pat = new RegExp(caseNo.replace(/\s+/gu, "").split("").join("\\s*"), "gu")
  const out: string[] = []
  for (const m of text.matchAll(pat)) {
    const window = text.slice(Math.max(0, (m.index ?? 0) - 40), m.index)
    const dates = [...window.matchAll(/(\d{4})\s*\.\s*(\d{1,2})\s*\.\s*(\d{1,2})/gu)]
    const last = dates[dates.length - 1]
    if (last) out.push(`${last[1]}${last[2].padStart(2, "0")}${last[3].padStart(2, "0")}`)
  }
  return out
}

export function computeVerdict(items: GateItem[], pendingCount = 0): { verdict: GateVerdict; reasons: string[] } {
  const live = items.filter((i) => i.class !== "SKIP")
  if (live.length === 0) return { verdict: "NO_CITATIONS", reasons: ["검증할 인용이 없다. 통과가 아니라 '검증할 것이 없음'이다"] }
  const count = (c: GateClass) => live.filter((i) => i.class === c).length
  if (count("FAIL") > 0) {
    const extra = count("ERROR") ? [`조회 실패 ${count("ERROR")}건은 검증하지 못했다. 고친 뒤 다시 검증한다`] : []
    return { verdict: "FAIL", reasons: [`FAIL ${count("FAIL")}건. 점수와 무관하게 반려한다`, ...extra] }
  }
  // 조회가 실패한 인용이 있으면 통과 계열 판정을 내지 않는다. 검증하지 못한 것을 경고로 덮으면 게이트가 열린다
  if (count("ERROR") > 0) return { verdict: "INCOMPLETE", reasons: [`조회 실패 ${count("ERROR")}건. 검증을 끝내지 못했다. 인증키·네트워크·요청 상한을 확인하고 다시 돌린다`] }
  const reasons: string[] = []
  if (count("WARN") > 0) reasons.push(`WARN ${count("WARN")}건. 경고를 본문에 반영해야 통과한다`)
  if (pendingCount > 0) reasons.push(`문맥 확인이 필요한 인용 ${pendingCount}건. 확인 전에는 PASS를 주지 않는다`)
  return { verdict: reasons.length ? "PASS_WITH_WARNINGS" : "PASS", reasons }
}
