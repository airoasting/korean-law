/**
 * 조문 표기와 법제처 조문 코드(JO) 사이의 변환.
 *
 * 법제처 Open API는 조문을 여섯 자리 숫자로 받는다. 앞 네 자리가 조 번호, 뒤 두 자리가 '…조의N'의 N이다.
 * 제750조 → 075000, 제382조의3 → 038203.
 *
 * "제382조의3", "382조의3", "제382조-3", "382", "제 382 조 의 3"을 모두 읽는다. 뒤에 붙은 항·호는 버린다.
 * 숫자를 찾지 못하면 예외를 던진다 (호출하는 쪽이 '조문 없음'으로 다룬다).
 */

// 사용자 입력에 닿는 정규식이므로 숫자 자릿수에 상한을 둔다
const LEAD = /^\s*제?\s*(\d{1,9})(?!\d)\s*조?(?:\s*(?:의|-)\s*(\d{1,3})(?!\d))?/u

export function toJoCode(text: string): string {
  const m = LEAD.exec(String(text ?? ""))
  if (!m) throw new Error(`조문 번호를 읽지 못했다: ${String(text).slice(0, 40)}`)
  return m[1].padStart(4, "0") + (m[2] ?? "0").padStart(2, "0")
}

/** 여섯 자리 코드가 아니면 받은 그대로 돌려준다 */
export function fromJoCode(code: string): string {
  const c = String(code ?? "").trim()
  if (!/^\d{6}$/u.test(c)) return c
  const branch = Number(c.slice(4))
  return `제${Number(c.slice(0, 4))}조${branch ? `의${branch}` : ""}`
}
