/**
 * 법령 찾기: 검색, 법령명 특정(약칭·옛 이름·폐지 포함), 시행 연혁, 조문 조회.
 *
 * 법제처 '현행' 본문(lawService target=law, MST만)은 공포본의 마지막 시행 슬라이스다. 분리 시행 중인 법령은
 * 아직 시행되지 않은 개정·삭제가 섞여 온다. 그래서 오늘(또는 기준일) 효력을 보는 조회는 언제나
 * 시행일을 지정해(target=eflaw, MST+efYd) 받고, 마지막 슬라이스는 '앞으로 바뀌는지' 비교할 때만 쓴다.
 */
import { LawApi, list, text } from "./http.js"
import { aliasKey, officialName } from "./aliases.js"
import { ENCLOSED_NUMBERS } from "./title-match.js"

export interface LawRow {
  name: string
  lawId: string
  mst: string
  efYd: string
  promulgated: string
  status: string
  revision: string
  kind: string
  abbr: string
}

export type LawLookup =
  | { kind: "found"; law: LawRow; via?: string }
  | { kind: "renamed"; oldName: string; current: LawRow; lastOld?: LawRow }
  | { kind: "repealed"; last: LawRow }
  | { kind: "partial"; candidates: LawRow[] }
  | { kind: "none" }

function toRow(r: any): LawRow {
  return {
    name: text(r.법령명한글), lawId: text(r.법령ID), mst: text(r.법령일련번호), efYd: text(r.시행일자),
    promulgated: text(r.공포일자), status: text(r.현행연혁코드), revision: text(r.제개정구분명),
    kind: text(r.법령구분명), abbr: text(r.법령약칭명),
  }
}

export async function searchLaws(api: LawApi, params: { query?: string; lawId?: string; target?: "law" | "eflaw"; page?: number; display?: number }) {
  const json = await api.json("lawSearch.do", {
    target: params.target ?? "law", query: params.query, LID: params.lawId,
    display: String(params.display ?? 100), page: String(params.page ?? 1),
    nw: params.target === "eflaw" ? "1,2,3" : undefined,
  })
  const root = json?.LawSearch ?? {}
  return { total: Number(text(root.totalCnt)) || 0, rows: list(root.law).map(toRow) }
}

/** 법령명(약칭 포함)과 정확히 같은 현행 법령. 법제처 검색은 포함 검색이라 앞 페이지에 비슷한 이름이 먼저 올 수 있어 3쪽까지 본다 */
export async function findExactLaw(api: LawApi, name: string): Promise<{ law?: LawRow; firstPage: LawRow[] }> {
  const official = officialName(name).name
  const keys = new Set([aliasKey(official), aliasKey(name)])
  let firstPage: LawRow[] = []
  for (let page = 1; page <= 3; page++) {
    const { total, rows } = await searchLaws(api, { query: official, page })
    if (page === 1) firstPage = rows
    const hit = rows.find((r) => keys.has(aliasKey(r.name)) || (r.abbr && keys.has(aliasKey(r.abbr))))
    if (hit) return { law: hit, firstPage }
    if (page * 100 >= total) break
  }
  return { firstPage }
}

/** 법령ID의 모든 시행 슬라이스 (시행예정·현행·연혁), 시행일 내림차순 */
export async function lawVersions(api: LawApi, lawId: string): Promise<LawRow[]> {
  const out: LawRow[] = []
  for (let page = 1; page <= 10; page++) {
    const { total, rows } = await searchLaws(api, { lawId, target: "eflaw", page })
    out.push(...rows.filter((r) => r.lawId.replace(/^0+/u, "") === lawId.replace(/^0+/u, "")))
    if (page * 100 >= total || rows.length === 0) break
  }
  return out.sort((a, b) => b.efYd.localeCompare(a.efYd) || Number(b.mst) - Number(a.mst))
}

/** ymd(YYYYMMDD)에 시행 중이던 슬라이스 */
export function versionAt(versions: LawRow[], ymd: string): LawRow | undefined {
  return versions.find((v) => v.efYd && v.efYd <= ymd)
}

export async function resolveLaw(api: LawApi, name: string): Promise<LawLookup> {
  const alias = officialName(name)
  const { law, firstPage } = await findExactLaw(api, name)
  if (law) return { kind: "found", law, via: alias.viaAlias }
  // 옛 이름 또는 폐지: 연혁 검색에서 같은 이름을 찾고, 그 법령ID의 현재 상태를 본다
  const key = aliasKey(alias.name)
  const history = (await searchLaws(api, { query: alias.name, target: "eflaw" })).rows.filter((r) => aliasKey(r.name) === key)
  if (history.length) {
    const lineage = await lawVersions(api, history[0].lawId)
    const current = lineage.find((v) => v.status === "현행")
    const lastOld = history.sort((a, b) => b.efYd.localeCompare(a.efYd))[0]
    if (current && aliasKey(current.name) !== key) return { kind: "renamed", oldName: alias.name, current, lastOld }
    if (current) return { kind: "found", law: current }
    if (lineage.some((v) => /폐지$/u.test(v.revision))) return { kind: "repealed", last: lineage[0] ?? lastOld }
  }
  return firstPage.length ? { kind: "partial", candidates: firstPage.slice(0, 3) } : { kind: "none" }
}

/** 조문 단위 조회. efYd를 주면 그날 시행 중인 본문, 안 주면 공포본의 마지막 슬라이스 */
export async function fetchUnit(api: LawApi, q: { mst: string; jo: string; efYd?: string }): Promise<Record<string, any> | undefined> {
  const json = await api.json("lawService.do", { target: q.efYd ? "eflaw" : "law", MST: q.mst, JO: q.jo, efYd: q.efYd })
  const article = Number(q.jo.slice(0, 4))
  const branch = Number(q.jo.slice(4, 6))
  // JO를 무시하고 전체 조문이 오는 경우도 있어 번호로 다시 고른다
  return list<Record<string, any>>(json?.법령?.조문?.조문단위).find((u) =>
    text(u.조문여부) === "조문" && Number(text(u.조문번호)) === article && (Number(text(u.조문가지번호)) || 0) === branch)
}

/** "①" 또는 "1" → 1 */
export function paragraphNumber(raw: unknown): number {
  const s = text(raw).trim()
  const circled = ENCLOSED_NUMBERS.indexOf(s.charAt(0))
  if (circled >= 0) return circled + 1
  const n = parseInt(s, 10)
  return Number.isFinite(n) ? n : NaN
}

export function paragraphs(unit: Record<string, any>): Array<Record<string, any>> {
  return list<Record<string, any>>(unit.항)
}

/** 항(또는 조 바로 아래)의 호 번호들. "1." "1의2." → 앞 숫자 */
export function itemNumbers(unit: Record<string, any>, paragraph?: number): number[] {
  const pool = paragraph ? paragraphs(unit).filter((p) => paragraphNumber(p.항번호) === paragraph) : [unit, ...paragraphs(unit)]
  return pool.flatMap((p) => list<Record<string, any>>(p.호).map((h) => parseInt(text(h.호번호), 10))).filter(Number.isFinite)
}

/** 그 호 아래 목 글자들. "가." → "가" */
export function subItemLetters(unit: Record<string, any>, paragraph: number | undefined, item: number): string[] {
  const pool = paragraph ? paragraphs(unit).filter((p) => paragraphNumber(p.항번호) === paragraph) : [unit, ...paragraphs(unit)]
  return pool.flatMap((p) => list<Record<string, any>>(p.호))
    .filter((h) => parseInt(text(h.호번호), 10) === item)
    .flatMap((h) => list<Record<string, any>>(h.목).map((m) => text(m.목번호).trim().charAt(0)))
    .filter((ch) => /[가-힣]/u.test(ch))
}
