/**
 * 판례·헌재 결정 사건번호 뽑기와 조회.
 *
 * 사건번호 = 접수 연도 4자리 + 사건부호 + 일련번호 (예: 2013다61381, 2004헌마554).
 * 사건부호는 법원 사건별 부호문자 체계를 따른다. 일련번호 뒤에 '명·원·건' 같은 수량 낱말이 오면 사건번호가 아니다.
 */
import { LawApi, list, text } from "./http.js"

// 긴 부호를 먼저 둔다 (가합이 가보다 먼저 맞도록)
const CASE_MARKS = [
  "헌가", "헌나", "헌다", "헌라", "헌마", "헌바", "헌사", "헌아",
  "가합", "가단", "가소", "가기", "카합", "카단", "카기", "고합", "고단", "고정", "고약", "구합", "구단",
  "드합", "드단", "느합", "느단", "즈합", "즈단",
  "다", "나", "라", "마", "그", "머", "도", "노", "로", "모", "오", "초", "두", "누", "루", "무", "부", "아",
  "므", "르", "브", "스", "으", "즈", "허", "후", "흐", "히", "재", "추", "수",
]
const CASE_RE = new RegExp(
  `(?<![\\d가-힣])((?:19|20)\\d{2})\\s?(${CASE_MARKS.join("|")})\\s?(\\d{1,7})(?!\\d|\\s?(?:명|개|원|건|회|차|억|천|만|년|월|일|조|항|호|목|%|위|번째))`,
  "gu",
)

export interface CaseRef {
  caseNo: string
  index: number
  year: number
  constitutional: boolean
}

export function findCaseNumbers(text: string, max = 20): CaseRef[] {
  const out: CaseRef[] = []
  const seen = new Set<string>()
  for (const m of text.matchAll(CASE_RE)) {
    const caseNo = `${m[1]}${m[2]}${m[3]}`
    if (seen.has(caseNo)) continue
    seen.add(caseNo)
    out.push({ caseNo, index: m.index ?? 0, year: Number(m[1]), constitutional: m[2].startsWith("헌") })
    if (out.length >= max) break
  }
  return out
}

/** 접수 연도가 올해보다 뒤면 존재할 수 없는 사건번호다 */
export function isImpossibleCase(ref: CaseRef, now = new Date()): boolean {
  return ref.year > now.getFullYear()
}

export interface CaseRecord {
  caseNo: string
  id: string
  court: string
  /** 선고일 또는 종국일 YYYYMMDD */
  date: string
  name: string
  enBanc: boolean
}

const sameCaseField = (field: string, caseNo: string) => field.replace(/\s/gu, "").split(/[,·]/u).includes(caseNo)
const digits = (s: string) => s.replace(/\D/gu, "")

/** 법제처 수록 판례·헌재 결정에서 사건번호가 정확히 같은 것. 사건번호 검색은 앞부분 일치라 정확 일치만 인정한다 */
export async function lookupCase(api: LawApi, caseNo: string): Promise<CaseRecord | undefined> {
  if (caseNo.includes("헌")) {
    const json = await api.json("lawSearch.do", { target: "detc", nb: caseNo, display: "20" })
    const hit = list(json?.DetcSearch?.Detc).find((d: any) => sameCaseField(text(d.사건번호), caseNo))
    return hit && { caseNo, id: text(hit.헌재결정례일련번호), court: "헌법재판소", date: digits(text(hit.종국일자)), name: text(hit.사건명), enBanc: false }
  }
  const json = await api.json("lawSearch.do", { target: "prec", nb: caseNo, display: "20" })
  const hit = list(json?.PrecSearch?.prec).find((p: any) => sameCaseField(text(p.사건번호), caseNo))
  return hit && {
    caseNo, id: text(hit.판례일련번호), court: text(hit.법원명), date: digits(text(hit.선고일자)), name: text(hit.사건명),
    enBanc: /전원합의체/u.test(text(hit.판결유형)),
  }
}
