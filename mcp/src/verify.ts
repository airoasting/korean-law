/**
 * verify_document: 법률 문서 한 편의 조문·판례 인용을 검증해 게이트 판정(JSON + 검증표)을 낸다.
 *
 * 정규화(normalize.ts) → 인용 추출(citations.ts) → 법령·판례 확인
 *   조문: 법령 특정(약칭·옛 이름·폐지), 기준일 본문 대조, 삭제 조문, 항·호·목 존재, 제목 대조,
 *         시행 예정 개정, 시행 전 신설 조문
 *   판례: 실존 불가 사건번호, 법제처 수록 여부, 선고일 대조, 생사(전원합의체 변경), 헌재 결정
 * 문서 자체 조항은 EXCLUDED, 생략된 법령명은 믿을 만할 때만 추정하고 나머지는 needs_context로 넘긴다 (스킬이 문맥 확인).
 * 조회가 실패한 인용은 ERROR_LOOKUP으로 남겨 판정을 INCOMPLETE로 막는다. 인증키가 없으면 판정 없이 오류로 끝난다.
 */
import { BudgetExceeded, DrfError, LawApi, text } from "./http.js"
import { normalizeCitationText } from "./normalize.js"
import { extractArticleCitations, type ArticleCitation } from "./citations.js"
import { findCaseNumbers, isImpossibleCase, lookupCase, type CaseRef } from "./cases.js"
import { checkPrecedent } from "./citator.js"
import { fetchUnit, itemNumbers, lawVersions, paragraphNumber, paragraphs, resolveLaw, subItemLetters, versionAt, type LawRow } from "./laws.js"
import { compareTitles } from "./title-match.js"
import {
  citedDates, computeVerdict, isAliasShaped, isBareDecree, isDeletedUnit, isHistoricalCitation, lawCandidates,
  makeItem, titleKey, unitText, VERDICT_KO, type GateItem, type GateStatus,
} from "./verdict.js"
import { renderGateMarkdown } from "./render.js"

export interface VerifyOptions {
  text: string
  asOf?: string
  maxCitations?: number
  maxCases?: number
  citeCheck?: boolean
}

type Evidence = GateItem["evidence"][number]
const ev = (check: string, evidence: string, source: string): Evidence => ({ check, evidence, source })

function seoulToday(): string {
  return new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10).replace(/-/gu, "")
}

function note(error: unknown): string {
  if (error instanceof BudgetExceeded) return "요청 상한을 넘어 확인하지 못했다"
  return `조회 실패: ${error instanceof Error ? error.message : String(error)}`
}

/** 찾은 법령에서 조문을 대조한다. 기준일(asOf)이 있으면 그날 슬라이스, 없으면 오늘 시행 중인 본문 */
async function checkArticleInLaw(api: LawApi, law: LawRow, c: ArticleCitation, asOf: string | undefined, doc: string): Promise<{ status: GateStatus; evidence: Evidence[]; title?: string }> {
  const slice = asOf ? versionAt(await lawVersions(api, law.lawId), asOf) : law
  if (!slice) return { status: "WARN_NOT_YET_EFFECTIVE", evidence: [ev("ASOF_CHECK", `기준일 ${asOf}에는 아직 시행 전인 법령이다`, "법령 연혁")] }
  const unit = await fetchUnit(api, { mst: slice.mst, jo: c.jo, efYd: slice.efYd })
  const latest = await fetchUnit(api, { mst: law.mst, jo: c.jo })
  const src = `${law.name} (시행 ${slice.efYd}, MST ${slice.mst})`
  if (!unit) {
    if (latest && !isDeletedUnit(latest)) return { status: "WARN_NOT_YET_EFFECTIVE", evidence: [ev("PENDING_CHECK", `시행 예정 본문에만 있다: ${text(latest.조문내용).slice(0, 60)}`, src)] }
    return { status: "FAIL_NOT_FOUND", evidence: [ev("ARTICLE_CHECK", `${law.name}에 ${c.display}가 없다`, src)] }
  }
  if (isDeletedUnit(unit)) return { status: "FAIL_DELETED", evidence: [ev("DELETED_CHECK", text(unit.조문내용), src)] }
  const title = text(unit.조문제목) || undefined
  if (c.hang) {
    const nums = paragraphs(unit).map((p) => paragraphNumber(p.항번호)).filter(Number.isFinite)
    if (!nums.includes(c.hang)) {
      const later = latest ? paragraphs(latest).map((p) => paragraphNumber(p.항번호)) : []
      if (later.includes(c.hang)) return { status: "WARN_NOT_YET_EFFECTIVE", title, evidence: [ev("PENDING_CHECK", `제${c.hang}항은 시행 예정 본문에만 있다`, src)] }
      if (!nums.length) return { status: "WARN_UNCHECKED", title, evidence: [ev("PARAGRAPH_CHECK", `${c.display}는 항으로 나뉘지 않은 조문이다`, src)] }
      return { status: "FAIL_NOT_FOUND", title, evidence: [ev("PARAGRAPH_CHECK", `제${c.hang}항이 없다 (최대 제${Math.max(...nums)}항)`, src)] }
    }
  }
  if (c.ho) {
    const items = itemNumbers(unit, c.hang)
    if (items.length && !items.includes(c.ho)) {
      const later = latest ? itemNumbers(latest, c.hang) : []
      if (later.includes(c.ho)) return { status: "WARN_NOT_YET_EFFECTIVE", title, evidence: [ev("PENDING_CHECK", `제${c.ho}호는 시행 예정 본문에만 있다`, src)] }
      return { status: "FAIL_NOT_FOUND", title, evidence: [ev("ITEM_CHECK", `제${c.ho}호가 없다 (최대 제${Math.max(...items)}호)`, src)] }
    }
    if (!items.length) return { status: "WARN_UNCHECKED", title, evidence: [ev("ITEM_CHECK", "호 구조를 읽지 못했다", src)] }
  }
  if (c.ho && c.mok) {
    const letters = subItemLetters(unit, c.hang, c.ho)
    if (!letters.length) return { status: "WARN_UNCHECKED", title, evidence: [ev("SUBITEM_CHECK", `제${c.ho}호는 목으로 나뉘지 않았거나 목 구조를 읽지 못했다`, src)] }
    if (!letters.includes(c.mok)) {
      const later = latest ? subItemLetters(latest, c.hang, c.ho) : []
      if (later.includes(c.mok)) return { status: "WARN_NOT_YET_EFFECTIVE", title, evidence: [ev("PENDING_CHECK", `제${c.ho}호 ${c.mok}목은 시행 예정 본문에만 있다`, src)] }
      return { status: "FAIL_NOT_FOUND", title, evidence: [ev("SUBITEM_CHECK", `제${c.ho}호에 ${c.mok}목이 없다 (${letters[0]}목~${letters[letters.length - 1]}목)`, src)] }
    }
  }
  if (c.claimTitle && title) {
    if (!compareTitles(c.claimTitle, title).ok) return { status: "FAIL_MISMATCH", title, evidence: [ev("TITLE_CHECK", `인용 제목 '${c.claimTitle}' ≠ 실제 '${title}'`, src)] }
    if (titleKey(c.claimTitle) !== titleKey(title)) return { status: "WARN_TITLE_DIFF", title, evidence: [ev("TITLE_CHECK", `본문 제목 '${c.claimTitle}' ≠ 실제 '${title}'`, src)] }
  }
  if (latest && unitText(latest) !== unitText(unit)) {
    const head = isDeletedUnit(latest) ? `이후 삭제됨(예정 포함): ${text(latest.조문내용)}` : `대조 본문(시행 ${slice.efYd}) 이후 개정 있음(예정 포함)`
    return { status: "WARN_PENDING_CHANGE", title, evidence: [ev("PENDING_CHECK", head, src)] }
  }
  void doc
  return { status: "OK", title, evidence: [ev("ARTICLE_CHECK", `${law.name} ${c.display}${title ? `(${title})` : ""} 실존`, src)] }
}

/** 문서에서 index가 든 문장 (문서 자체 조항의 근거로 남긴다) */
function sentenceAt(doc: string, index: number): string {
  const ends = [...doc.matchAll(/(?:[다함음임요]\.|[?!])(?=\s|$)|\n/gu)].map((m) => (m.index ?? 0) + m[0].length)
  const start = Math.max(0, ...ends.filter((e) => e <= index))
  const end = ends.find((e) => e > index) ?? doc.length
  return doc.slice(start, end).trim()
}

/** "제2조 제3호 다목"처럼 항·호·목까지 붙인 조문 표기 */
function ref(c: ArticleCitation): string {
  return `${c.display}${c.hang ? ` 제${c.hang}항` : ""}${c.ho ? ` 제${c.ho}호` : ""}${c.mok ? ` ${c.mok}목` : ""}`
}

async function checkArticle(api: LawApi, c: ArticleCitation, id: string, doc: string, asOf?: string): Promise<GateItem> {
  const lawName = c.lawName ?? ""
  const base = { id, kind: "law" as const, law: lawName, cited_law: lawName, article: c.display, claimed_title: c.claimTitle,
    cited: `${lawName} ${ref(c)}`.trim(), source_line: c.raw }
  if (c.selfClause) {
    return makeItem({ ...base, status: "EXCLUDED", evidence: [ev("SCOPE_CHECK", sentenceAt(doc, c.index), "문서 자체의 조항 (인용 추출)")] })
  }
  if (!c.lawName || isBareDecree(lawName)) {
    return makeItem({ ...base, status: "WARN_UNCHECKED", needs_context: true, law_candidates: lawCandidates(lawName),
      evidence: [ev("SCOPE_CHECK", c.lawName ? `부모 법령이 없는 '${lawName}'` : "법령명을 정하지 못한 조문", "인용 추출")] })
  }
  if (!c.inferred) return checkNamed(api, c, base, lawName, doc, asOf)
  // 앞 법령에서 추정한 법령명. 같은 문장이면 그대로 믿는다. 같은 문단이면 인용 제목이 실제 제목과 맞을 때만 믿는다
  const scope = c.inferred === "sentence" ? "문장" : "문단"
  const guess = ev("LAW_INFERRED", `법령명이 없어 같은 ${scope}의 「${lawName}」로 봤다`, "인용 추출")
  const item = await checkNamed(api, c, { ...base, cited_law: "" }, lawName, doc, asOf)
  if (item.class === "ERROR") return item
  const trusted = c.inferred === "sentence"
    || (!!c.claimTitle && !!item.title && compareTitles(c.claimTitle, item.title).ok)
  if (trusted) return { ...item, evidence: [guess, ...item.evidence] }
  return makeItem({ ...base, law: "", cited: ref(c), status: "WARN_UNCHECKED", needs_context: true, law_candidates: [lawName],
    evidence: [ev("SCOPE_CHECK", `법령명이 없다. 같은 문단의 「${lawName}」일 가능성이 높다 (그 법령으로 조회하면 ${item.status})`, "인용 추출")] })
}

type ArticleBase = Omit<GateItem, "status" | "class" | "reason" | "fix" | "evidence">

async function checkNamed(api: LawApi, c: ArticleCitation, base: ArticleBase, lawName: string, doc: string, asOf?: string): Promise<GateItem> {
  try {
    // 원래 이름으로 먼저, 안 되면 문장 조각을 뗀 짧은 후보부터 (옛 이름·폐지 판정도 후보마다 한다)
    const names = [lawName, ...lawCandidates(lawName).filter((x) => normalizeName(x) !== normalizeName(lawName))]
    let firstMiss: Awaited<ReturnType<typeof resolveLaw>> | undefined
    for (const name of names) {
      const r = await resolveLaw(api, name)
      const via = name !== lawName ? [ev("ALIAS_CHECK", `'${lawName}' → 후보 '${name}'`, "법제처 법령 검색")] : []
      if (r.kind === "found") {
        const res = await checkArticleInLaw(api, r.law, c, asOf, doc)
        const aliased = normalizeName(r.law.name) !== normalizeName(name)
        const status: GateStatus = res.status === "OK" && aliased ? "OK_ALIAS" : res.status
        const aliasEv = aliased && !via.length ? [ev("ALIAS_CHECK", `'${lawName}' → ${r.law.name}`, "법제처 법령 검색")] : via
        return makeItem({ ...base, law: r.law.name, cited: `${r.law.name} ${ref(c)}`, title: res.title, status, evidence: [...aliasEv, ...res.evidence] })
      }
      if (r.kind === "renamed") {
        return makeItem({ ...base, law: r.oldName, cited: `${r.oldName} ${ref(c)}`, status: "WARN_RENAMED", evidence: [...via, ev("RENAME_CHECK", `옛 법령명. 현행은 「${r.current.name}」 (법령ID ${r.current.lawId})`, "법령 연혁")] })
      }
      if (r.kind === "repealed") {
        const status: GateStatus = isHistoricalCitation(name, doc) ? "WARN_REPEALED_HISTORICAL" : "FAIL_REPEALED"
        return makeItem({ ...base, law: r.last.name, cited: `${name} ${ref(c)}`, status, evidence: [...via, ev("REPEAL_CHECK", `「${r.last.name}」은 폐지된 법령이다 (마지막 시행 ${r.last.efYd}, ${r.last.revision})`, "법령 연혁")] })
      }
      firstMiss ??= r
    }
    const cands = lawCandidates(lawName)
    const status: GateStatus = cands.some(isAliasShaped) ? "WARN_ALIAS_UNREGISTERED" : "FAIL_LAW_NOT_FOUND"
    const near = firstMiss?.kind === "partial" ? ` (비슷한 이름: ${firstMiss.candidates.map((x) => x.name).join(", ")})` : ""
    return makeItem({ ...base, status, law_candidates: cands, evidence: [ev("LAW_CHECK", `정확히 같은 법령이 없다${near}`, "법제처 법령 검색")] })
  } catch (error) {
    return makeItem({ ...base, status: "ERROR_LOOKUP", evidence: [ev("LAW_CHECK", note(error), "법제처")] })
  }
}

const normalizeName = (s: string) => s.replace(/[\s·ㆍ]/gu, "")

async function checkCase(api: LawApi, ref: CaseRef, id: string, doc: string, citeCheck: boolean): Promise<GateItem> {
  const base = { id, kind: "case" as const, cited: ref.caseNo, case_no: ref.caseNo, source_line: ref.caseNo }
  if (isImpossibleCase(ref)) return makeItem({ ...base, status: "FAIL_IMPOSSIBLE_CASE", evidence: [ev("CASE_CHECK", `접수 연도 ${ref.year}는 아직 오지 않았다`, "사건번호 형식")] })
  try {
    const rec = await lookupCase(api, ref.caseNo)
    if (!rec) return makeItem({ ...base, status: "WARN_CASE_UNVERIFIED", evidence: [ev("CASE_CHECK", `법제처 수록 ${ref.constitutional ? "헌재 결정" : "판례"}에서 찾지 못했다 (하급심·미수록일 수 있어 부존재로 단정하지 않는다)`, "법제처 검색")] })
    const found = ev("CASE_CHECK", `${rec.caseNo} 실존: ${rec.court} ${rec.date} ${rec.name}`, "법제처 검색")
    const claimed = citedDates(ref.caseNo, doc)
    if (rec.date && claimed.some((d) => d !== rec.date)) {
      return makeItem({ ...base, status: "FAIL_CASE_MISMATCH", evidence: [found, ev("DATE_CHECK", `본문 선고일 ${claimed.join(", ")} ≠ 실제 ${rec.date} (${rec.name})`, "법제처 검색")] })
    }
    if (ref.constitutional || !citeCheck) return makeItem({ ...base, status: "OK", evidence: [found] })
    const c = await checkPrecedent(api, ref.caseNo)
    const status: GateStatus = c.verdict === "overruled" ? "FAIL_OVERRULED" : c.verdict === "uncertain" ? "WARN_CITE_UNCERTAIN" : "OK"
    return makeItem({ ...base, status, evidence: [found, ev("PRECEDENT_CHECK", c.summary, "판례 생사 확인")] })
  } catch (error) {
    return makeItem({ ...base, status: "ERROR_LOOKUP", evidence: [ev("CASE_CHECK", note(error), "법제처")] })
  }
}

async function pool<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i) }
  }))
  return out
}

export async function verifyDocument(api: LawApi, opt: VerifyOptions) {
  // 인증키 없이 돌리면 모든 조회가 실패한다. 그 결과를 판정으로 내놓지 않고 바로 멈춘다
  if (!api.hasKey) throw new DrfError("법제처 인증키(KOREAN_LAW_OC)가 없어 검증할 수 없다. mcp/.env에 KOREAN_LAW_OC=인증키를 넣는다")
  const asOf = opt.asOf?.replace(/-/gu, "")
  const { text: doc, changes } = normalizeCitationText(opt.text)
  const articles = extractArticleCitations(doc, opt.maxCitations ?? 40)
  const cases = findCaseNumbers(doc, opt.maxCases ?? 15)
  const lawItems = await pool(articles, 6, (c, i) => checkArticle(api, c, `L${i + 1}`, doc, asOf))
  const caseItems: GateItem[] = []
  for (const [i, ref] of cases.entries()) caseItems.push(await checkCase(api, ref, `C${i + 1}`, doc, opt.citeCheck ?? true))
  const items = [...lawItems, ...caseItems]
  const pending = items.filter((i) => i.needs_context).map((i) => i.id)
  const { verdict, reasons } = computeVerdict(items, pending.length)
  const evidence = {
    schema: "korean-law/evidence@2", engine: "verify_document", verdict, verdict_ko: VERDICT_KO[verdict], reasons,
    checked_at: `${seoulToday().slice(0, 4)}-${seoulToday().slice(4, 6)}-${seoulToday().slice(6)}`, as_of: asOf ?? null,
    normalize_changes: changes, items, pending_checks: pending, data_source: "법제처 국가법령정보센터 Open API",
  }
  return { evidence, markdown: renderGateMarkdown(evidence) }
}
