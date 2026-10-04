/**
 * 인용 표기 정규화 (스킬 scripts/kl.py normalize_text와 같은 규칙).
 *
 * 인용 추출(citations.ts)은 '제N조' 꼴만 인용으로 잡는다. AI가 쓴 문서에는 '민법 750조', '민법 §398',
 * '제390조 및 제750조', '○○법(이하 '△△법')' 같은 표기가 흔해서 그대로 넣으면 인용을 놓치거나 법령명을 못 붙인다.
 * 모든 규칙은 바꾼 내역을 돌려준다 (검증표에 그대로 싣는다).
 */

import { reEscape } from "./text.js"

export interface NormalizeChange {
  rule: "alias-definition" | "alias-expand" | "section-sign" | "missing-je" | "missing-je-hang" | "carry-law-name"
  before: string
  after: string
}

const LAW_TAIL = "법령칙률정례"
// 사용자 입력에 닿는 정규식이라 반복에 상한을 둔다
const ALIAS_DEF_RE = new RegExp(
  `([가-힣][가-힣·ㆍ ]{0,60}?(?:법률|법|시행령|시행규칙))[ \\t]*` +
  `\\(\\s*이하\\s*['"‘’“”「」『』]?\\s*([가-힣]{2,12})\\s*['"‘’“”「」『』]?\\s*(?:이?라\\s*(?:한다|함|칭한다))?\\s*\\)`,
  "gu",
)
// 법령명 앞에 붙은 문장 조각을 끊는 어절 끝. 조사와 연결어미("쓰이므로", "내용으로")를 함께 본다 (예시 실측: "같은 내용으로 쓰이므로 약관의 … 법률")
const PARTICLE_END = ["에서는", "에서", "에게", "에는", "서는", "는", "은", "를", "을", "으면", "하면", "면", "하며", "하고", "라도", "지만",
  "므로", "으로", "하여", "해서", "이고", "이며", "인데", "니까", "고", "며"]

/** 문장 조각이 붙은 법령명에서 조사로 끝나는 마지막 어절 뒤만 남긴다 ("회사는 주식회사 등의 … 법률" → "주식회사 등의 … 법률") */
export function stripSentenceLead(name: string): string {
  const toks = name.trim().split(/\s+/u)
  for (let i = toks.length - 2; i >= 0; i--) {
    if (PARTICLE_END.some((p) => toks[i].endsWith(p))) return toks.slice(i + 1).join(" ")
  }
  return toks.join(" ")
}


export function normalizeCitationText(input: string): { text: string; changes: NormalizeChange[] } {
  const changes: NormalizeChange[] = []
  const sub = (text: string, re: RegExp, rule: NormalizeChange["rule"], fn: (m: string, ...g: string[]) => string) =>
    text.replace(re, (m: string, ...rest: unknown[]) => {
      const groups = rest.slice(0, -2).map((g) => (typeof g === "string" ? g : ""))
      const next = fn(m, ...groups)
      if (next !== m) changes.push({ rule, before: m, after: next })
      return next
    })

  // 0. 약칭 정의: 괄호를 걷고, 뒤에 나오는 약칭을 정식 명칭으로 바꾼다
  const aliases = new Map<string, string>()
  let text = sub(input, ALIAS_DEF_RE, "alias-definition", (_m, full, alias) => {
    aliases.set(alias, stripSentenceLead(full))
    return full.trimEnd()
  })
  for (const [alias, full] of aliases) {
    const re = new RegExp(`(?<![가-힣])${reEscape(alias)}(?=\\s*(?:시행령|시행규칙|제\\s*\\d)|\\s|[,.)]|$)`, "gu")
    text = sub(text, re, "alias-expand", () => full)
  }

  // 1. "§398", "§398의2" → "제398조", "제398조의2"
  text = sub(text, /§\s*(\d{1,4})(?:\s*의\s*(\d{1,3}))?/gu, "section-sign",
    (_m, jo, br) => `제${jo}조${br ? `의${br}` : ""}`)
  // 2. 법령명 바로 뒤의 "750조" → "제750조" (금액 '3조 원'은 건드리지 않는다)
  text = sub(text, new RegExp(`(?<=[${LAW_TAIL}])( ?)(\\d{1,4})\\s*조(?!\\s*원)(?:\\s*의\\s*(\\d{1,3}))?`, "gu"), "missing-je",
    (_m, sp, jo, br) => `${sp}제${jo}조${br ? `의${br}` : ""}`)
  // 3. "제23조 1항 2호" → "제23조 제1항 제2호"
  text = sub(text, /(제\d{1,4}조(?:의\d{1,3})?)\s+(\d{1,3})\s*항(?:\s*(\d{1,3})\s*호)?/gu, "missing-je-hang",
    (_m, art, hang, ho) => `${art} 제${hang}항${ho ? ` 제${ho}호` : ""}`)
  // 4. "상법 제399조, 제401조" → "…, 같은 법 제401조" (법령명을 복사하면 앞 어절까지 딸려 온다. 인용 추출은 '같은 법'을 앞 법령으로 해석)
  const carry = new RegExp(
    `([${LAW_TAIL}]\\s*제\\d{1,4}조(?:의\\d{1,3})?(?:\\s*제\\d{1,3}항)?(?:\\s*제\\d{1,3}호)?(?:\\([^)]{0,60}\\))?)` +
    `(\\s*(?:,|및|과|와|또는|내지|이나|나)\\s*)(제\\d{1,4}조)`, "gu")
  for (let guard = 0; guard < 50; guard++) {
    const next = sub(text, carry, "carry-law-name", (_m, first, sep, nxt) => `${first}${sep}같은 법 ${nxt}`)
    if (next === text) break
    text = next
  }
  return { text, changes }
}
