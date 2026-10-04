/** 정규식 메타문자 이스케이프 */
export function reEscape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")
}

/** 공백 연속을 하나로 접고 앞뒤를 자른다 */
export function squash(value: string): string {
  return String(value ?? "").replace(/\s+/gu, " ").trim()
}
