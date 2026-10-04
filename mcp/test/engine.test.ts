import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { BudgetExceeded, LawApi, DrfError, list, text } from "../src/http.js"
import { loadEnv } from "../src/env.js"
import { scanBody } from "../src/citator.js"
import { computeVerdict, isAliasShaped, isBareDecree, isDeletedUnit, makeItem, titleKey, unitText, citedDates } from "../src/verdict.js"
import { itemNumbers, paragraphNumber, versionAt, type LawRow } from "../src/laws.js"

const fakeFetch = (bodies: Array<{ status?: number; body: string }>) => {
  let i = 0
  const seenUrls: string[] = []
  const f = (async (url: URL) => {
    seenUrls.push(String(url))
    const b = bodies[Math.min(i++, bodies.length - 1)]
    return new Response(b.body, { status: b.status ?? 200 })
  }) as unknown as typeof fetch
  return { f, seenUrls }
}

describe("법제처 API 클라이언트", () => {
  it("요청 상한을 넘으면 BudgetExceeded", async () => {
    const { f } = fakeFetch([{ body: "{\"a\":1}" }])
    const api = new LawApi({ apiKey: "KEY123", fetchImpl: f, cacheTtlMs: 0 })
    await expect(api.withBudget(1, async () => { await api.json("lawSearch.do", { q: "1" }); await api.json("lawSearch.do", { q: "2" }) })).rejects.toBeInstanceOf(BudgetExceeded)
  })
  it("HTML 응답은 오류로, 메시지에서 인증키를 가린다", async () => {
    const { f } = fakeFetch([{ body: "<html>KEY123 안내</html>" }])
    const api = new LawApi({ apiKey: "KEY123", fetchImpl: f, retries: 0 })
    const err = await api.json("lawService.do", {}).catch((e) => e)
    expect(err).toBeInstanceOf(DrfError)
    expect(String(err.message)).not.toContain("KEY123")
  })
  it("429는 다시 시도하고, 같은 요청은 캐시한다", async () => {
    const { f, seenUrls } = fakeFetch([{ status: 429, body: "" }, { body: "{\"ok\":true}" }])
    const api = new LawApi({ apiKey: "K", fetchImpl: f, retries: 1 })
    expect(await api.json("lawSearch.do", { query: "민법" })).toEqual({ ok: true })
    expect(await api.json("lawSearch.do", { query: "민법" })).toEqual({ ok: true })
    expect(seenUrls.length).toBe(2)
  })
  it("list·text 도우미", () => {
    expect(list({ a: 1 })).toEqual([{ a: 1 }])
    expect(list(undefined)).toEqual([])
    expect(text({ content: "본문" })).toBe("본문")
  })
})

describe(".env 로딩", () => {
  it("이미 있는 환경변수는 덮어쓰지 않는다", () => {
    const dir = mkdtempSync(join(tmpdir(), "kl-"))
    const file = join(dir, ".env")
    writeFileSync(file, "# 주석\nKL_TEST_A=1\nKL_TEST_B='두 번째'\n")
    process.env.KL_TEST_A = "keep"
    loadEnv(file)
    expect(process.env.KL_TEST_A).toBe("keep")
    expect(process.env.KL_TEST_B).toBe("두 번째")
  })
})

describe("판례 본문 스캔", () => {
  it("대상 사건번호 주변의 변경 문구", () => {
    expect(scanBody("종전 대법원 2004. 7. 15. 선고 2004도2965 전원합의체 판결은 이 판결의 견해에 배치되는 범위에서 이를 모두 변경하기로 한다.", "2004도2965").change).toBeTruthy()
    expect(scanBody("대법원 2008다38288 판결 참조", "2008다38288")).toEqual({ found: true })
    expect(scanBody("대법원 2013다613810 판결을 변경하기로 한다", "2013다61381")).toEqual({ found: false })
  })
})

describe("판정 규칙", () => {
  it("삭제 조문, 비교용 본문, 제목 키, 약칭 꼴, 시행령 단독", () => {
    expect(isDeletedUnit({ 조문내용: "제241조 삭제 <2016.1.6>" })).toBe(true)
    expect(isDeletedUnit({ 조문내용: "제17조(개인정보의 제공)", 항: [{}] })).toBe(false)
    expect(unitText({ 조문내용: "제1조", 항: [{ 항내용: "① 가 <개정 2021.1.5>" }] })).toBe(unitText({ 조문내용: "제1조", 항: [{ 항내용: "①  가" }] }))
    expect(titleKey("이사회 보고 및 승인 등")).toBe(titleKey("이사회 보고·승인"))
    expect(isAliasShaped("외감법 시행령")).toBe(true)
    expect(isAliasShaped("임원 보수 공시에 관한 법률")).toBe(false)
    expect(isBareDecree("호와 시행령")).toBe(true)
    expect(isBareDecree("도시가스사업법 시행령")).toBe(false)
    expect(citedDates("2002두12052", "(대법원 2003. 7. 22. 선고 2002두12052 판결)")).toEqual(["20030722"])
  })
  it("문서 판정", () => {
    const ok = makeItem({ id: "L1", kind: "law", cited: "민법 제1조", status: "OK", source_line: "" })
    const fail = makeItem({ id: "L2", kind: "law", cited: "민법 제1200조", status: "FAIL_NOT_FOUND", source_line: "" })
    expect(computeVerdict([ok]).verdict).toBe("PASS")
    expect(computeVerdict([ok], 1).verdict).toBe("PASS_WITH_WARNINGS")
    expect(computeVerdict([ok, fail]).verdict).toBe("FAIL")
    expect(computeVerdict([]).verdict).toBe("NO_CITATIONS")
  })
})

describe("조문 구조와 연혁", () => {
  it("항 번호, 호 번호, 기준일 슬라이스", () => {
    expect(paragraphNumber("②")).toBe(2)
    const unit = { 항: [{ 항번호: "①", 호: [{ 호번호: "1." }, { 호번호: "2." }] }] }
    expect(itemNumbers(unit, 1)).toEqual([1, 2])
    const v = (efYd: string, mst: string) => ({ efYd, mst } as LawRow)
    expect(versionAt([v("20270101", "3"), v("20261002", "2"), v("20260820", "1")], "20261004")?.mst).toBe("2")
  })
})
