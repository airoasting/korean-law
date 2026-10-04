/**
 * 인용 제목이 실제 조문 제목과 같은 조문을 가리키는지 본다 (느슨한 대조).
 *
 * 잡으려는 것: 있는 조문 번호에 다른 조문의 제목을 붙인 인용 (민법 제750조(계약해제) 같은 것).
 * 표기만 다른 진짜 인용을 떨어뜨리면 안 되므로 너그럽게 본다. 표기 차이 경고는 verdict.ts titleKey가 따로 낸다.
 *
 * 1. 공백·낫표를 정리하면 같다 → same
 * 2. 한쪽이 다른 쪽 안에 들어 있다 → contains ("불법행위" 와 "불법행위의 내용")
 * 3. 두 글자 조각이 충분히 겹친다 → overlap
 *    (조각 집합의 교집합/합집합 0.5 이상, 또는 인용 제목 조각의 60% 이상이 실제 제목에 있음)
 * 4. 그 밖에는 differ
 */

/** 항 번호에 쓰는 원문자 1~50 */
export const ENCLOSED_NUMBERS = Array.from({ length: 50 }, (_, i) =>
  String.fromCodePoint(i < 20 ? 0x2460 + i : i < 35 ? 0x3251 + i - 20 : 0x32b1 + i - 35)).join("")

export interface TitleVerdict {
  ok: boolean
  how: "same" | "contains" | "overlap" | "differ"
  /** 0~1. contains는 길이 비, overlap은 겹침 비율 */
  score: number
}

/** 원문자는 (n)으로, 낫표는 지우고, 특수 공백은 보통 공백 하나로 */
export function plainTitle(raw: string): string {
  const chars = [...String(raw ?? "")].filter((ch) => !"「」『』".includes(ch)).map((ch) => {
    const n = ENCLOSED_NUMBERS.indexOf(ch)
    return n < 0 ? ch : `(${n + 1})`
  })
  return chars.join("").replace(/[  -​　]/gu, " ").replace(/\s+/gu, " ").trim()
}

function pieces(s: string): Set<string> {
  const t = s.replace(/[\s·ㆍ‧,.()]/gu, "")
  return new Set(Array.from({ length: Math.max(0, t.length - 1) }, (_, i) => t.slice(i, i + 2)))
}

export function compareTitles(claimed: string, real: string): TitleVerdict {
  const x = plainTitle(claimed)
  const y = plainTitle(real)
  if (!x || !y) return { ok: false, how: "differ", score: 0 }
  if (x === y) return { ok: true, how: "same", score: 1 }
  const sx = x.replace(/\s/gu, "")
  const sy = y.replace(/\s/gu, "")
  if (Math.min(sx.length, sy.length) >= 2 && (sx.includes(sy) || sy.includes(sx))) {
    return { ok: true, how: "contains", score: Math.min(sx.length, sy.length) / Math.max(sx.length, sy.length) }
  }
  const px = pieces(x)
  const py = pieces(y)
  const shared = [...px].filter((p) => py.has(p)).length
  const union = px.size + py.size - shared
  const ratio = union ? shared / union : 0
  const cover = px.size ? shared / px.size : 0
  const ok = ratio >= 0.5 || cover >= 0.6
  return { ok, how: ok ? "overlap" : "differ", score: Math.max(ratio, cover) }
}
