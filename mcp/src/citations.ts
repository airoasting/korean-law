/**
 * 문서에서 조문 인용 뽑기.
 *
 * 규칙
 * - 조문: "제N조", "제N조의M", 뒤에 "제K항", "제L호"가 붙을 수 있다 (표기 정규화 뒤의 텍스트를 받는다)
 * - 법령명: 조문 바로 앞, 같은 문장 안의 낱말 덩어리가 법령명 꼴(…법·법률·시행령·시행규칙·규칙·규정·조례)로 끝나면 그것이다.
 *   앞에 붙은 문장 조각("강제하는 행위는 공정거래법")은 조사·연결어미에서 끊고, '구'·'현행'·'경우' 같은 말은 뗀다
 * - "같은 법", "동법"(+ 시행령·시행규칙)은 같은 문단에서 마지막으로 나온 법령을 가리킨다
 * - 조문 바로 뒤 괄호는 인용한 조문 제목으로 본다 ("(이하 …)"와 날짜는 제외)
 * - 법령명을 정하지 못한 조문도 버리지 않고 lawName 없이 돌려준다 (문맥 확인 대상)
 */
import { toJoCode, fromJoCode } from "./jo.js"
import { aliasKey } from "./aliases.js"
import { stripSentenceLead } from "./normalize.js"

export interface ArticleCitation {
  raw: string
  index: number
  lawName?: string
  jo: string
  display: string
  article: number
  branch: number
  hang?: number
  ho?: number
  claimTitle?: string
}

const ARTICLE_PATTERN = /제\s?(\d{1,4})\s?조(?:\s?의\s?(\d{1,3}))?(?:\s?제\s?(\d{1,3})\s?항)?(?:\s?제\s?(\d{1,3})\s?호)?/gu
const LAW_TAIL_RE = /(?:법률|법|시행령|시행규칙|규칙|규정|조례)$/u
const ANAPHORA_RE = /^(?:같은|동)\s?법(?:률)?(?:\s?(시행령|시행규칙))?$/u
const LEAD_WORDS = new Set(["구", "현행", "개정", "및", "또는", "또한", "그리고", "따라", "따라서", "경우", "때", "이", "그", "본", "해당",
  "관련", "아울러", "특히", "즉", "각", "위", "이에", "다만", "또", "그러나", "한편", "나아가", "역시", "특별히", "먼저", "끝으로"])
const SUBORDINATE_RE = /\s?(시행령|시행규칙)$/u

function lawNameBefore(lookback: string): string | undefined {
  let s = lookback.replace(/[「」『』"'“”‘’]/gu, " ").replace(/\s+/gu, " ").trimEnd()
  const tail = /([가-힣A-Za-z0-9·ㆍ ]{1,80})$/u.exec(s)
  if (!tail) return undefined
  s = tail[1].trim()
  // "또한 같은 법"처럼 앞말이 붙은 지시어: 문장 조각을 떼기 전에 먼저 본다 ("같은"이 조사로 끝나는 말처럼 보여서다)
  const anaphora = /(?:^|\s)((?:같은|동)\s?법(?:률)?(?:\s?(?:시행령|시행규칙))?)$/u.exec(s)
  if (anaphora) return anaphora[1]
  if (!LAW_TAIL_RE.test(s)) return undefined
  let name = stripSentenceLead(s)
  const toks = name.split(" ")
  while (toks.length > 1 && LEAD_WORDS.has(toks[0])) toks.shift()
  name = toks.join(" ")
  // 부모 법령 없이 "…와 시행령"으로 끝나면 앞 조각은 법령명이 아니다. "시행령"만 남겨 문맥 확인으로 넘긴다
  const decree = /(?:^|\s)(시행령|시행규칙)$/u.exec(name)
  if (decree && !toks.slice(0, -1).some((t) => /(?:법|법률)$/u.test(t))) return decree[1]
  return LAW_TAIL_RE.test(name) ? name : undefined
}

function claimTitleAfter(after: string): string | undefined {
  const m = /^\s?\(([^()]{1,60})\)/u.exec(after)
  if (!m) return undefined
  const t = m[1].trim()
  if (/^이하\s/u.test(t) || /^\d{4}\s?\./u.test(t) || /^[\d\s.,·~-]+$/u.test(t)) return undefined
  return t
}

export function extractArticleCitations(text: string, max = 60): ArticleCitation[] {
  const out: ArticleCitation[] = []
  const seen = new Set<string>()
  const paragraphStarts = [0]
  for (const m of text.matchAll(/\n\s*\n/gu)) paragraphStarts.push((m.index ?? 0) + m[0].length)
  const paragraphOf = (i: number) => paragraphStarts.filter((p) => p <= i).length - 1
  const lastLawInParagraph = new Map<number, string>()
  let prevEnd = 0

  for (const m of text.matchAll(ARTICLE_PATTERN)) {
    const index = m.index ?? 0
    const para = paragraphOf(index)
    const sentenceStart = Math.max(
      text.lastIndexOf(".", index - 1) + 1, text.lastIndexOf("\n", index - 1) + 1,
      text.lastIndexOf(";", index - 1) + 1, paragraphStarts[para], prevEnd, index - 90,
    )
    let lawName = lawNameBefore(text.slice(sentenceStart, index))
    if (lawName && ANAPHORA_RE.test(lawName)) {
      const base = lastLawInParagraph.get(para)
      const sub = ANAPHORA_RE.exec(lawName)?.[1]
      lawName = base ? (sub ? `${base} ${sub}` : base) : undefined
    }
    if (lawName) lastLawInParagraph.set(para, lawName.replace(SUBORDINATE_RE, ""))
    prevEnd = index + m[0].length

    const article = Number(m[1])
    const branch = m[2] ? Number(m[2]) : 0
    const display = `제${article}조${branch ? `의${branch}` : ""}`
    const jo = toJoCode(display)
    const hang = m[3] ? Number(m[3]) : undefined
    const ho = m[4] ? Number(m[4]) : undefined
    const key = `${aliasKey(lawName ?? "")}|${jo}|${hang ?? ""}|${ho ?? ""}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ raw: m[0], index, lawName, jo, display: fromJoCode(jo), article, branch, hang, ho,
      claimTitle: claimTitleAfter(text.slice(prevEnd, prevEnd + 70)) })
    if (out.length >= max) break
  }
  return out
}
