/**
 * 판례 생사 확인: 대상 판례를 인용한 후속 판결을 찾아, 본문에서 그 판례를 변경·폐기한다는 문구가 있는지 본다.
 *
 * - 판례 변경은 대법원 전원합의체만 할 수 있다(법원조직법 제7조). 그래서 후속 전원합의체 판결은 최대 10건까지 모두 읽고,
 *   그 밖의 판결은 대법원·최신 순으로 3건만 읽는다.
 * - 본문에서 대상 사건번호를 찾고, 그 앞뒤 350자 안에 변경 문구가 있으면 '변경'으로 본다.
 * - 후속 판결 어디에서도 대상 인용을 확인하지 못했거나, 전원합의체 본문에서 대상 인용을 못 찾으면 '불확실'로 둔다.
 */
import { LawApi, list, text } from "./http.js"
import { lookupCase, type CaseRecord } from "./cases.js"

export type CitatorVerdict = "overruled" | "uncertain" | "alive" | "no_citing" | "not_found"

export interface CitatorResult {
  verdict: CitatorVerdict
  target?: CaseRecord
  summary: string
  citing: CaseRecord[]
  scanned: Array<{ caseNo: string; enBanc: boolean; found: boolean; change?: string; context?: string }>
  overruledBy?: string
}

const CHANGE_RE = /(?:변경하기로\s?한다|변경하기로\s?하고|이를\s?(?:모두\s?)?변경한다|변경되어야\s?한다|폐기하기로\s?한다|폐기한다|배치되는\s?범위\s?(?:안|내)에서|견해를\s?달리하는\s?범위)/u
const MAX_EN_BANC = 10
const MAX_OTHER = 3

/** 본문에서 대상 사건번호 주변의 변경 문구를 찾는다 (API 없이 쓰는 순수 함수) */
export function scanBody(body: string, caseNo: string): { found: boolean; change?: string; context?: string } {
  const flat = body.replace(/\s+/gu, " ")
  const pattern = new RegExp(caseNo.split("").map((c) => c.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")).join("\\s?") + "(?!\\d)", "gu")
  let found = false
  for (const m of flat.matchAll(pattern)) {
    found = true
    const i = m.index ?? 0
    const window = flat.slice(Math.max(0, i - 350), i + caseNo.length + 350)
    const change = CHANGE_RE.exec(window)
    if (change) return { found, change: change[0], context: window.slice(0, 300) }
  }
  return { found }
}

async function decisionBody(api: LawApi, id: string): Promise<string> {
  const json = await api.json("lawService.do", { target: "prec", ID: id })
  const p = json?.PrecService ?? {}
  return [text(p.판례내용), text(p.판결요지), text(p.참조판례)].join("\n")
}

export async function checkPrecedent(api: LawApi, caseNo: string): Promise<CitatorResult> {
  const target = await lookupCase(api, caseNo)
  if (!target) return { verdict: "not_found", summary: `법제처 수록 판례에서 ${caseNo}를 찾지 못했다 (부존재로 단정하지 않는다)`, citing: [], scanned: [] }
  const json = await api.json("lawSearch.do", { target: "prec", search: "2", query: caseNo, display: "100" })
  const citing: CaseRecord[] = list(json?.PrecSearch?.prec)
    .map((p: any) => ({ caseNo: text(p.사건번호), id: text(p.판례일련번호), court: text(p.법원명),
      date: text(p.선고일자).replace(/\D/gu, ""), name: text(p.사건명), enBanc: /전원합의체/u.test(text(p.판결유형)) }))
    .filter((c) => c.id !== target.id && (!target.date || !c.date || c.date >= target.date))
  if (!citing.length) return { verdict: "no_citing", target, summary: "법제처 수록 범위에서 이 판례를 인용한 후속 판결이 없다", citing, scanned: [] }

  const order = (a: CaseRecord, b: CaseRecord) =>
    Number(b.court === "대법원") - Number(a.court === "대법원") || b.date.localeCompare(a.date)
  const picks = [...citing.filter((c) => c.enBanc).sort(order).slice(0, MAX_EN_BANC), ...citing.filter((c) => !c.enBanc).sort(order).slice(0, MAX_OTHER)]
  const scanned: CitatorResult["scanned"] = []
  let failed = 0
  for (const c of picks) {
    try {
      scanned.push({ caseNo: c.caseNo, enBanc: c.enBanc, ...scanBody(await decisionBody(api, c.id), caseNo) })
    } catch {
      failed++
    }
  }
  const changed = scanned.find((s) => s.change)
  if (changed) return { verdict: "overruled", target, citing, scanned, overruledBy: changed.caseNo, summary: `${changed.caseNo} 본문에 변경 문구("${changed.change}")가 있다` }
  const enBancMissing = scanned.some((s) => s.enBanc && !s.found)
  if (failed || enBancMissing || (scanned.length && scanned.every((s) => !s.found))) {
    return { verdict: "uncertain", target, citing, scanned, summary: failed ? `후속 판결 ${failed}건의 본문을 받지 못했다` : "후속 판결 본문에서 대상 인용을 확인하지 못한 곳이 있다" }
  }
  const enBancCount = scanned.filter((s) => s.enBanc).length
  return { verdict: "alive", target, citing, scanned, summary: `후속 인용 ${citing.length}건, 변경 문구 없음${enBancCount ? ` (전원합의체 ${enBancCount}건 포함 확인)` : ""}` }
}

export const VERDICT_MARK: Record<CitatorVerdict, string> = {
  overruled: "❌ 변경·폐기", uncertain: "⚠️ 불확실", alive: "✅ 유효 (계속 인용)", no_citing: "ℹ️ 후속 인용 없음", not_found: "⚠️ 판례 미확인",
}
