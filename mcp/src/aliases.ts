/**
 * 법령 이름 다루기: 비교용 키, 검색어 정리, 약칭·통칭 → 정식 법령명.
 *
 * 약칭 사전은 법제처가 정한 법령약칭명(alias-data.ts)과 통칭 보충표(alias-informal.ts)다.
 * 정규식은 모두 입력 길이에 선형이다.
 */
import { OFFICIAL_LAW_ALIASES } from "./alias-data.js"
import { INFORMAL_LAW_ALIASES } from "./alias-informal.js"

export interface OfficialName {
  /** 정식 법령명. 사전에 없으면 정리한 입력 그대로 */
  name: string
  /** 약칭으로 풀었으면 그 약칭 */
  viaAlias?: string
}

/** 같은 법령인지 비교하는 키. 소문자로 바꾸고 공백, 가운뎃점 다섯 가지, 괄호, 따옴표, 하이픈을 지운다.
 *  NFKC는 쓰지 않는다. 법제처 법령명에 쓰는 'ㆍ'(U+318D)를 다른 글자로 바꿔 검색이 깨진다 */
export function aliasKey(text: string): string {
  return String(text ?? "").toLowerCase().replace(/[\s·ㆍ‧•・「」『』〈〉《》<>()[\]{}'"‘’“”\-‐‑–—―]/gu, "")
}

/** 법제처로 보낼 검색어. 공백을 접고 낫표·따옴표를 지우고 대시를 '-'로 맞춘다. 법령명 글자는 건드리지 않는다 */
export function tidyLawQuery(text: string): string {
  return String(text ?? "").replace(/[「」『』'"‘’“”]/gu, "").replace(/[‐‑–—―−]/gu, "-").replace(/\s+/gu, " ").trim()
}

let table: Map<string, string> | undefined

function aliasTable(): Map<string, string> {
  if (table) return table
  table = new Map()
  // 통칭을 먼저 넣는다. 같은 키가 공식 약칭에도 있으면 먼저 들어간 쪽을 쓴다
  for (const [short, full] of [...INFORMAL_LAW_ALIASES, ...OFFICIAL_LAW_ALIASES]) {
    const k = aliasKey(short)
    if (k && k !== aliasKey(full) && !table.has(k)) table.set(k, full)
  }
  return table
}

/** "공정거래법", "공정거래법 시행령" → 정식 법령명. 하위 법령 접미사는 본 법령 약칭을 푼 뒤 다시 붙인다 */
export function officialName(text: string): OfficialName {
  const input = tidyLawQuery(text)
  const whole = aliasTable().get(aliasKey(input))
  if (whole) return { name: whole, viaAlias: input }
  const sub = /^(.+?)\s*(시행령|시행규칙)$/u.exec(input)
  const parent = sub && aliasTable().get(aliasKey(sub[1]))
  if (sub && parent) return { name: `${parent} ${sub[2]}`, viaAlias: input }
  return { name: input }
}
