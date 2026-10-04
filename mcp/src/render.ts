/**
 * 법률 근거 검증표(마크다운) 렌더링. 스킬 scripts/kl.py render_md 와 같은 모양이다.
 */
import type { GateItem } from "./verdict.js"

interface EvidenceView {
  verdict: string
  verdict_ko: string
  reasons: string[]
  checked_at: string
  normalize_changes: Array<{ before: string; after: string }>
  items: GateItem[]
  pending_checks: string[]
}

const cell = (s: unknown) => String(s ?? "").replace(/\|/gu, "\\|").replace(/\n/gu, " ")

function counts(items: GateItem[], kind: "law" | "case"): string {
  const sub = items.filter((i) => i.kind === kind && i.class !== "SKIP")
  const n = (c: string) => sub.filter((i) => i.class === c).length
  return `${sub.length}건 (통과 ${n("PASS")}, 경고 ${n("WARN")}, 실패 ${n("FAIL")})`
}

export function renderGateMarkdown(ev: EvidenceView): string {
  const out = [
    "# 법률 근거 검증표",
    "",
    `- 판정: **${ev.verdict} (${ev.verdict_ko})**`,
    `- 확인일: ${ev.checked_at}`,
    `- 법령 인용 ${counts(ev.items, "law")} · 판례 인용 ${counts(ev.items, "case")}`,
    ...ev.reasons.map((r) => `- ${r}`),
    "",
  ]
  const groups: Array<[string, string]> = [["FAIL", "반려 사유"], ["WARN", "경고"], ["PASS", "통과"]]
  for (const [cls, title] of groups) {
    const rows = ev.items.filter((i) => i.class === cls)
    if (!rows.length) continue
    out.push(`## ${title} (${rows.length})`, "")
    if (cls === "PASS") {
      out.push("| # | 인용 | 판정 |", "|---|---|---|")
      for (const i of rows) out.push(`| ${i.id} | ${cell(i.cited)} | ${cell(i.reason)} |`)
    } else {
      out.push("| # | 인용 | 판정 | 근거 | 고칠 곳 |", "|---|---|---|---|---|")
      for (const i of rows) {
        const basis = i.evidence.length ? i.evidence[i.evidence.length - 1].evidence : i.source_line
        const fix = i.needs_context ? "같은 문단에서 법령명을 정해 '<법령명> 제N조'로 다시 검증한다" : i.fix
        out.push(`| ${i.id} | ${cell(i.cited)} | ${cell(i.reason)} | ${cell(basis)} | ${cell(fix)} |`)
      }
    }
    out.push("")
  }
  if (ev.normalize_changes.length) {
    out.push("## 표기 정규화", "", "엔진이 읽을 수 있도록 다음 표기를 바꿔 검증했다.", "")
    for (const c of ev.normalize_changes) out.push(`- \`${c.before}\` → \`${c.after}\``)
    out.push("")
  }
  out.push(
    "---",
    "",
    "출처: 법제처 국가법령정보센터 OPEN API. 이 표는 인용의 실존과 현행 여부를 확인한 것이며 법률 자문이 아니다. "
    + "법적 효력이 필요한 판단은 국가법령정보센터 원문을 확인한다. 판례 '미확인'은 부존재를 뜻하지 않는다.",
  )
  return out.join("\n")
}
