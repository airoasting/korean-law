/**
 * MCP 도구 구현: 법령 검색·본문, 판례·헌재 결정 검색·본문, 판례 생사 확인, 문서 검증.
 * 각 함수는 사람이 읽는 텍스트를 돌려준다. verify_document 만 판정 JSON을 앞에 붙인다.
 */
import { LawApi, list, text } from "./http.js"
import { aliasKey, officialName } from "./aliases.js"
import { toJoCode } from "./jo.js"
import { findExactLaw, lawVersions, resolveLaw, searchLaws, versionAt, type LawRow } from "./laws.js"
import { checkPrecedent, VERDICT_MARK } from "./citator.js"
import { verifyDocument, type VerifyOptions } from "./verify.js"

function seoulToday(): string {
  return new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10).replace(/-/gu, "")
}

/** 법제처 본문의 HTML 태그와 엔티티를 걷어 낸다 */
export function plain(html: unknown): string {
  return text(html)
    .replace(/<br\s*\/?>/giu, "\n")
    .replace(/<[^>]{1,200}>/gu, "")
    .replace(/&nbsp;/gu, " ").replace(/&lt;/gu, "<").replace(/&gt;/gu, ">").replace(/&quot;/gu, '"').replace(/&#39;/gu, "'").replace(/&amp;/gu, "&")
    .replace(/[ \t]+\n/gu, "\n").replace(/\n{3,}/gu, "\n\n").trim()
}

function lawLine(r: LawRow): string {
  return `${r.name}${r.abbr ? ` (약칭: ${r.abbr})` : ""} | ${r.kind} | 법령ID ${r.lawId} | MST ${r.mst} | 시행 ${r.efYd} | ${r.status || "현행"}`
}

export async function findLawTool(api: LawApi, query: string, display = 20): Promise<string> {
  const { law } = await findExactLaw(api, query)
  const { total, rows } = await searchLaws(api, { query: officialName(query).name, display: Math.min(Math.max(display, 1), 100) })
  const lines = [`검색어: ${query}${officialName(query).viaAlias ? ` → ${officialName(query).name}` : ""} (전체 ${total}건)`, ""]
  if (law) {
    lines.push(`정확히 같은 법령: ${lawLine(law)}`)
    const upcoming = (await lawVersions(api, law.lawId)).filter((v) => v.efYd > seoulToday())
    for (const u of upcoming.reverse()) lines.push(`  시행 예정: ${u.efYd} (공포 ${u.promulgated}, ${u.revision}, MST ${u.mst})`)
    lines.push("")
  }
  const others = rows.filter((r) => !law || r.mst !== law.mst)
  if (others.length) lines.push("그 밖의 결과:", ...others.slice(0, display).map((r) => `- ${lawLine(r)}`))
  if (!law && !rows.length) lines.push("결과 없음. 법령명을 다시 확인한다 (추측하지 않는다)")
  return lines.join("\n")
}

function formatUnit(u: Record<string, any>): string {
  const out = [plain(u.조문내용)]
  for (const p of list<Record<string, any>>(u.항)) {
    if (text(p.항내용)) out.push(plain(p.항내용))
    for (const h of list<Record<string, any>>(p.호)) {
      out.push(`  ${plain(h.호내용)}`)
      for (const m of list<Record<string, any>>(h.목)) out.push(`    ${plain(m.목내용)}`)
    }
  }
  for (const h of list<Record<string, any>>(u.호)) out.push(`  ${plain(h.호내용)}`)
  return out.filter(Boolean).join("\n")
}

export async function readLawTool(api: LawApi, q: { lawName?: string; lawId?: string; mst?: string; jo?: string; efYd?: string }): Promise<string> {
  let mst = q.mst
  let efYd = q.efYd?.replace(/-/gu, "")
  let name = ""
  if (!mst) {
    let lawId = q.lawId
    if (!lawId && q.lawName) {
      const r = await resolveLaw(api, q.lawName)
      if (r.kind === "found") lawId = r.law.lawId
      else if (r.kind === "renamed") lawId = r.current.lawId
      else if (r.kind === "repealed") lawId = r.last.lawId
      else return `법령을 특정하지 못했다: ${q.lawName}. find_law로 이름을 확인한다`
    }
    if (!lawId) return "lawName, lawId, mst 중 하나가 필요하다"
    const slice = versionAt(await lawVersions(api, lawId), efYd ?? seoulToday())
    if (!slice) return `그 날짜에 시행 중인 버전이 없다 (법령ID ${lawId})`
    mst = slice.mst; efYd = slice.efYd; name = slice.name
  }
  const json = await api.json("lawService.do", { target: efYd ? "eflaw" : "law", MST: mst, efYd, JO: q.jo ? toJoCode(q.jo) : undefined })
  const info = json?.법령?.기본정보 ?? {}
  const units = list<Record<string, any>>(json?.법령?.조문?.조문단위).filter((u) => text(u.조문여부) === "조문")
  const header = `${text(info.법령명_한글) || name} (시행 ${text(info.시행일자) || efYd || "?"}, MST ${mst})${efYd ? "" : "\n주의: 시행일을 지정하지 않은 본문이다. 아직 시행 전인 개정이 섞였을 수 있다"}`
  if (q.jo) {
    const want = toJoCode(q.jo)
    const u = units.find((x) => text(x.조문번호).padStart(4, "0") + String(Number(text(x.조문가지번호)) || 0).padStart(2, "0") === want)
    return u ? `${header}\n\n${formatUnit(u)}` : `${header}\n\n${q.jo}가 이 버전에 없다`
  }
  return `${header}\n\n${units.map(formatUnit).join("\n\n")}`
}

type Source = "court" | "constitutional"

export async function findDecisionTool(api: LawApi, q: { source: Source; query?: string; caseNumber?: string; display?: number }): Promise<string> {
  const display = String(Math.min(Math.max(q.display ?? 20, 1), 100))
  if (q.source === "constitutional") {
    const json = await api.json("lawSearch.do", { target: "detc", query: q.query, nb: q.caseNumber, display })
    const rows = list(json?.DetcSearch?.Detc)
    if (!rows.length) return "헌재 결정 검색 결과 없음 (추측하지 않는다)"
    return rows.map((d: any) => `- [${text(d.헌재결정례일련번호)}] ${text(d.사건번호)} | 종국 ${text(d.종국일자)} | ${text(d.사건명)}`).join("\n")
  }
  const json = await api.json("lawSearch.do", { target: "prec", query: q.query, nb: q.caseNumber, display })
  const rows = list(json?.PrecSearch?.prec)
  if (!rows.length) return "판례 검색 결과 없음 (하급심·미수록 판례일 수 있다. 추측하지 않는다)"
  return rows.map((p: any) => `- [${text(p.판례일련번호)}] ${text(p.사건번호)} | ${text(p.법원명)} ${text(p.선고일자)} | ${text(p.판결유형)} | ${text(p.사건명)}`).join("\n")
}

export async function readDecisionTool(api: LawApi, q: { source: Source; id: string }): Promise<string> {
  const json = await api.json("lawService.do", { target: q.source === "constitutional" ? "detc" : "prec", ID: q.id })
  const body = json?.[Object.keys(json ?? {})[0]] ?? {}
  const fields = q.source === "constitutional"
    ? ["사건명", "사건번호", "종국일자", "판시사항", "결정요지", "참조조문", "참조판례", "전문"]
    : ["사건명", "사건번호", "선고일자", "법원명", "판결유형", "판시사항", "판결요지", "참조조문", "참조판례", "판례내용"]
  const out = fields.filter((f) => text(body[f])).map((f) => `【${f}】\n${plain(body[f])}`)
  return out.length ? out.join("\n\n") : "본문을 받지 못했다"
}

export async function checkPrecedentTool(api: LawApi, caseNumber: string): Promise<string> {
  const caseNo = caseNumber.replace(/\s/gu, "").match(/(?:19|20)\d{2}[가-힣]{1,2}\d{1,7}/u)?.[0] ?? caseNumber.trim()
  const r = await checkPrecedent(api, caseNo)
  const lines = [`📊 판정: ${VERDICT_MARK[r.verdict]}. ${r.summary}`]
  if (r.target) lines.push(`대상: ${r.target.court} ${r.target.date} ${r.target.caseNo} ${r.target.enBanc ? "전원합의체 " : ""}${r.target.name}`)
  if (r.overruledBy) lines.push(`변경한 판결: ${r.overruledBy}`)
  if (r.scanned.length) {
    lines.push("", "본문을 읽은 후속 판결:")
    for (const s of r.scanned) lines.push(`- ${s.caseNo}${s.enBanc ? " (전원합의체)" : ""}: ${s.change ? `변경 문구 "${s.change}"` : s.found ? "인용 확인, 변경 문구 없음" : "대상 인용 확인 못 함"}`)
  }
  if (r.citing.length) {
    lines.push("", `후속 인용 판결 (${r.citing.length}건, 최근 10건):`)
    for (const c of [...r.citing].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10)) lines.push(`- ${c.court} ${c.date} ${c.caseNo}${c.enBanc ? " (전원합의체)" : ""} ${c.name}`)
  }
  lines.push("", "한계: 법제처 수록 판례 범위의 확인이다. 하급심·미수록 판례의 인용은 보지 못한다")
  return lines.join("\n")
}

export async function verifyDocumentTool(api: LawApi, opt: VerifyOptions): Promise<string> {
  const { evidence, markdown } = await verifyDocument(api, opt)
  // 판정 JSON을 앞에 둔다. 응답 상한에 걸려도 뒤쪽 검증표만 잘린다
  return `\`\`\`json\n${JSON.stringify(evidence)}\n\`\`\`\n\n${markdown}`
}

export { aliasKey }
