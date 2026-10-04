// 문서 파일 하나를 verify_document와 같은 엔진으로 검증해 판정 JSON(korean-law/evidence@2)을 표준출력으로 낸다.
// 사용: node mcp/scripts/verify-file.mjs <문서.md> [YYYY-MM-DD] > raw/document-1.json   (인증키는 mcp/.env 의 KOREAN_LAW_OC)
import { readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const { loadEnv } = await import(join(root, "build/env.js"))
const { LawApi } = await import(join(root, "build/http.js"))
const { verifyDocument } = await import(join(root, "build/verify.js"))
const [file, asOf] = process.argv.slice(2)
if (!file) {
  console.error("사용: node mcp/scripts/verify-file.mjs <문서.md> [YYYY-MM-DD]")
  process.exit(2)
}
loadEnv()
const api = new LawApi({ apiKey: process.env.KOREAN_LAW_OC || "" })
try {
  const { evidence } = await api.withBudget(Number(process.env.KOREAN_LAW_MAX_REQUESTS) || 400,
    () => verifyDocument(api, { text: readFileSync(file, "utf8"), asOf }))
  process.stdout.write(JSON.stringify(evidence, null, 2) + "\n")
  // 검증을 끝내지 못했으면 종료 코드로도 알린다 (판정 JSON은 그대로 낸다)
  if (evidence.verdict === "INCOMPLETE") process.exitCode = 3
} catch (error) {
  console.error(api.mask(error instanceof Error ? error.message : String(error)))
  process.exit(2)
}
