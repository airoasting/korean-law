/**
 * 문서에서 조문 인용 뽑기.
 *
 * 규칙
 * - 조문: "제N조", "제N조의M", 뒤에 "제K항", "제L호", "가목"이 붙을 수 있다 (표기 정규화 뒤의 텍스트를 받는다)
 * - 법령명: 조문 바로 앞, 같은 문장 안의 낱말 덩어리가 법령명 꼴(…법·법률·시행령·시행규칙·규칙·규정·조례)로 끝나면 그것이다.
 *   앞에 붙은 문장 조각("강제하는 행위는 공정거래법")은 조사·연결어미에서 끊고, '구'·'현행'·'경우' 같은 말은 뗀다
 * - "같은 법", "동법"(+ 시행령·시행규칙)은 같은 문단에서 마지막으로 나온 법령을 가리킨다
 * - 문서 자체의 조항("본 계약서 제12조", "정관 제10조", "취업규칙 제5조")은 selfClause로 표시한다
 * - 법령명이 없는 조문은 앞말이 조사·연결어미로 끝날 때만(앞 조문에 이어지는 말일 때만) 앞 법령으로 추정한다.
 *   같은 문장의 법령이면 inferred="sentence", 같은 문단의 법령이면 inferred="paragraph"다. 판정에서 얼마나 믿을지는 verify.ts가 정한다
 * - 조문 바로 뒤 괄호는 인용한 조문 제목으로 본다 ("(이하 …)"와 날짜는 제외)
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
  /** 목 글자 (가, 나, …) */
  mok?: string
  claimTitle?: string
  /** 법령명을 앞 법령에서 추정했다 */
  inferred?: "sentence" | "paragraph"
  /** 계약서·약관·정관처럼 문서 자체의 조항이다 */
  selfClause?: boolean
}

const ARTICLE_PATTERN = /제\s?(\d{1,4})\s?조(?:\s?의\s?(\d{1,3}))?(?:\s?제\s?(\d{1,3})\s?항)?(?:\s?제\s?(\d{1,3})\s?호)?(?:\s?([가나다라마바사아자차카타파하])\s?목)?/gu
const LAW_TAIL_RE = /(?:법률|법|시행령|시행규칙|규칙|규정|조례)$/u
const ANAPHORA_RE = /^(?:같은|동)\s?법(?:률)?(?:\s?(시행령|시행규칙))?$/u
const LEAD_WORDS = new Set(["구", "현행", "개정", "및", "또는", "또한", "그리고", "따라", "따라서", "경우", "때", "이", "그", "본", "해당",
  "관련", "아울러", "특히", "즉", "각", "위", "이에", "다만", "또", "그러나", "한편", "나아가", "역시", "특별히", "먼저", "끝으로"])
const SUBORDINATE_RE = /\s?(시행령|시행규칙)$/u
// 조문 바로 앞에 오면 문서 자체의 조항이다
const SELF_DOC_TAIL = /(?:^|[\s(「])(?:(?:본|이|동|위|해당|당해)\s?)?(?:계약서?|약관|정관|취업규칙|단체협약|협약서?|합의서|각서|규약|사규|내규|지침|매뉴얼|본\s?규정|이\s?규정|동\s?규정)\s*$/u
const SELF_DOC_NAME = /^(?:(?:본|이|동|당사|회사|사내)\s?)?(?:취업규칙|사내규정|내부규정|운영규정|회사규정|인사규정|규정|정관)$/u
// 앞말이 이렇게 끝나야 앞 조문에 이어지는 조문으로 본다 (조사, 연결어미, 여는 괄호, 쉼표)
const CONTINUES = /(?:^|[(,·]|[은는이가을를와과로에의도고며서면나]|및|또는|으로|에서|하여|따라|위해)\s*$/u

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
  // 부모 법령 없이 "…와 시행령"으로 끝나면 앞 조각은 법령명이 아니다. "시행령"만 남긴다
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

/** 문장 끝: '…다.', '…함.' 같은 종결, 물음표·느낌표, 줄바꿈. 날짜의 점("2003. 7. 22.")은 문장 끝이 아니다 */
function sentenceBreaks(text: string): number[] {
  const out = [0]
  for (const m of text.matchAll(/(?:[다함음임요]\.|[?!])(?=\s|$)|\n/gu)) out.push((m.index ?? 0) + m[0].length)
  return out
}

export function extractArticleCitations(text: string, max = 60): ArticleCitation[] {
  const out: ArticleCitation[] = []
  const seen = new Set<string>()
  const paragraphStarts = [0]
  for (const m of text.matchAll(/\n\s*\n/gu)) paragraphStarts.push((m.index ?? 0) + m[0].length)
  const breaks = sentenceBreaks(text)
  const paragraphOf = (i: number) => paragraphStarts.filter((p) => p <= i).length - 1
  const sentenceOf = (i: number) => breaks.filter((p) => p <= i).length - 1
  const parentInParagraph = new Map<number, string>()
  const fullInParagraph = new Map<number, string>()
  const fullInSentence = new Map<number, string>()
  const selfJos = new Set<string>()
  let prevEnd = 0

  for (const m of text.matchAll(ARTICLE_PATTERN)) {
    const index = m.index ?? 0
    const para = paragraphOf(index)
    const sent = sentenceOf(index)
    const sentenceStart = Math.max(
      text.lastIndexOf(".", index - 1) + 1, text.lastIndexOf("\n", index - 1) + 1,
      text.lastIndexOf(";", index - 1) + 1, paragraphStarts[para], prevEnd, index - 90,
    )
    const lookback = text.slice(sentenceStart, index)
    let lawName = lawNameBefore(lookback)
    let inferred: ArticleCitation["inferred"]
    let selfClause = false
    if (lawName && ANAPHORA_RE.test(lawName)) {
      const base = parentInParagraph.get(para)
      const sub = ANAPHORA_RE.exec(lawName)?.[1]
      lawName = base ? (sub ? `${base} ${sub}` : base) : undefined
    }
    if (lawName && SELF_DOC_NAME.test(lawName)) {
      lawName = undefined
      selfClause = true
    } else if (!lawName && SELF_DOC_TAIL.test(lookback.replace(/[「」『』"'“”‘’]/gu, ""))) {
      selfClause = true
    } else if (!lawName || /^(?:시행령|시행규칙)$/u.test(lawName)) {
      // 앞 법령에서 추정한다. 시행령만 적었으면 부모 법령에 붙이고, 법령명이 아예 없으면 앞 법령 그대로 쓴다
      const decree = lawName
      const fromSentence = decree ? parentInSentence(fullInSentence.get(sent)) : fullInSentence.get(sent)
      const fromParagraph = decree ? parentInParagraph.get(para) : fullInParagraph.get(para)
      const base = fromSentence ?? fromParagraph
      if (base && (decree || CONTINUES.test(lookback))) {
        lawName = decree ? `${base} ${decree}` : base
        inferred = fromSentence ? "sentence" : "paragraph"
      } else if (decree) {
        lawName = decree
      }
    }
    if (lawName && !inferred && !/^(?:시행령|시행규칙)$/u.test(lawName)) {
      parentInParagraph.set(para, lawName.replace(SUBORDINATE_RE, ""))
      fullInParagraph.set(para, lawName)
      fullInSentence.set(sent, lawName)
    }
    prevEnd = index + m[0].length

    const article = Number(m[1])
    const branch = m[2] ? Number(m[2]) : 0
    const display = `제${article}조${branch ? `의${branch}` : ""}`
    const jo = toJoCode(display)
    // 법령명도 추정도 없는 조문이 앞서 문서 자체 조항으로 본 번호와 같으면 그 조항을 다시 말한 것이다
    if (!lawName && !selfClause && selfJos.has(jo)) selfClause = true
    if (selfClause) selfJos.add(jo)
    const hang = m[3] ? Number(m[3]) : undefined
    const ho = m[4] ? Number(m[4]) : undefined
    const mok = m[5] && ho ? m[5] : undefined
    const key = `${selfClause ? "self:" : ""}${aliasKey(lawName ?? "")}|${jo}|${hang ?? ""}|${ho ?? ""}|${mok ?? ""}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ raw: m[0], index, lawName, jo, display: fromJoCode(jo), article, branch, hang, ho, mok,
      claimTitle: claimTitleAfter(text.slice(prevEnd, prevEnd + 70)), inferred, selfClause: selfClause || undefined })
    if (out.length >= max) break
  }
  return out
}

function parentInSentence(full: string | undefined): string | undefined {
  return full?.replace(SUBORDINATE_RE, "")
}
