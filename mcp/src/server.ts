#!/usr/bin/env node
/**
 * korean-law MCP 서버 (stdio).
 * 법률 문서의 조문·판례 인용을 법제처 국가법령정보센터 Open API로 검증한다.
 */
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { z } from "zod"
import { loadEnv } from "./env.js"
import { LawApi } from "./http.js"
import { checkPrecedentTool, readDecisionTool, readLawTool, findDecisionTool, findLawTool, verifyDocumentTool } from "./tools.js"

loadEnv()
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const version = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")).version as string
const api = new LawApi({ apiKey: process.env.KOREAN_LAW_OC ?? "" })
const LIMIT = Number(process.env.KOREAN_LAW_MAX_REQUESTS) || 400
const MAX_CHARS = 50_000

async function run(fn: () => Promise<string>) {
  try {
    const out = await api.withBudget(LIMIT, fn)
    const textOut = out.length > MAX_CHARS ? `${out.slice(0, MAX_CHARS)}\n\n(응답이 길어 ${MAX_CHARS.toLocaleString()}자에서 잘랐다)` : out
    return { content: [{ type: "text" as const, text: api.mask(textOut) }] }
  } catch (error) {
    return { isError: true, content: [{ type: "text" as const, text: api.mask(error instanceof Error ? error.message : String(error)) }] }
  }
}

const server = new McpServer({ name: "korean-law", version })
const source = z.enum(["court", "constitutional"]).describe("court=법원 판례, constitutional=헌법재판소 결정")

server.registerTool("verify_document", {
  description: "법률 문서(계약서 검토, 의견서, 준비서면 등)의 조문·판례 인용을 한 번에 검증해 게이트 판정(FAIL/PASS_WITH_WARNINGS/PASS)과 근거 JSON을 낸다. 실존·제목·폐지·옛 이름·삭제 조문·항호·시행 예정 개정·시행 전 신설 조문·판례 실존·선고일·판례 생사·헌재 결정까지 확인한다. 법령명이 생략된 조문은 needs_context로 표시하므로 같은 문단에서 법령명을 정해 '<법령명> 제N조' 줄로 다시 호출한다",
  inputSchema: {
    text: z.string().min(1).max(50_000).describe("검증할 문서 전문"),
    asOf: z.string().regex(/^\d{4}-?\d{2}-?\d{2}$/u).optional().describe("기준일 YYYY-MM-DD. 그날 시행 중이던 본문으로 대조한다 (생략하면 오늘)"),
    maxCitations: z.number().int().min(1).max(60).optional().describe("검증할 최대 조문 인용 수 (기본 40)"),
    maxCases: z.number().int().min(1).max(20).optional().describe("검증할 최대 판례 인용 수 (기본 15)"),
    citeCheck: z.boolean().optional().describe("실존 판례마다 생사를 확인한다 (기본 true)"),
  },
}, (args) => run(() => verifyDocumentTool(api, args)))

server.registerTool("check_precedent", {
  description: "판례 생사 확인: 이 판례를 인용한 후속 판결을 찾고, 전원합의체 판결 본문에서 변경·폐기 문구를 확인한다",
  inputSchema: { caseNumber: z.string().min(4).max(100).describe("사건번호 (예: 2013다61381)") },
}, ({ caseNumber }) => run(() => checkPrecedentTool(api, caseNumber)))

server.registerTool("find_law", {
  description: "법령 검색. 약칭(공정거래법 등)도 받는다. 정확히 같은 법령과 시행 예정 개정을 함께 보여 준다",
  inputSchema: {
    query: z.string().min(1).max(200).describe("법령명 또는 약칭"),
    display: z.number().int().min(1).max(100).optional().describe("최대 결과 수 (기본 20)"),
  },
}, ({ query, display }) => run(() => findLawTool(api, query, display)))

server.registerTool("read_law", {
  description: "법령 본문 조회. lawName 또는 lawId를 주면 오늘(또는 efYd 날짜)에 시행 중인 버전을 보여 준다. jo로 조문 하나만 볼 수 있다",
  inputSchema: {
    lawName: z.string().max(200).optional().describe("법령명 또는 약칭"),
    lawId: z.string().max(20).optional().describe("법령ID"),
    mst: z.string().max(20).optional().describe("법령일련번호(MST). efYd와 함께 주면 그 시행일 본문"),
    jo: z.string().max(30).optional().describe("조문 (예: 제750조, 제10조의2)"),
    efYd: z.string().regex(/^\d{4}-?\d{2}-?\d{2}$/u).optional().describe("기준일 YYYY-MM-DD"),
  },
}, (args) => run(() => readLawTool(api, args)))

server.registerTool("find_decision", {
  description: "판례·헌재 결정 검색. caseNumber로 사건번호 검색, query로 키워드 검색",
  inputSchema: {
    source,
    query: z.string().max(200).optional().describe("키워드"),
    caseNumber: z.string().max(100).optional().describe("사건번호"),
    display: z.number().int().min(1).max(100).optional().describe("최대 결과 수 (기본 20)"),
  },
}, (args) => run(() => findDecisionTool(api, args)))

server.registerTool("read_decision", {
  description: "판례·헌재 결정 본문 조회 (find_decision 결과의 일련번호로)",
  inputSchema: { source, id: z.string().min(1).max(20).describe("판례일련번호 또는 헌재결정례일련번호") },
}, (args) => run(() => readDecisionTool(api, args)))

await server.connect(new StdioServerTransport())
