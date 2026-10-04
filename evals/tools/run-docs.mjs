// 문서 파일 여러 편을 엔진(mcp/)의 verify_document로 1차 검증해 <출력폴더>/<파일이름>/evidence.{json,md}를 만든다.
// 사용: AS_OF=YYYY-MM-DD node evals/tools/run-docs.mjs <출력폴더> <문서.md...>   (인증키는 mcp/.env)
import { readFileSync, mkdirSync, writeFileSync } from "node:fs"
import { basename, dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const engine = join(resolve(dirname(fileURLToPath(import.meta.url)), "../.."), "mcp", "build")
const { loadEnv } = await import(join(engine, "env.js"))
const { LawApi } = await import(join(engine, "http.js"))
const { verifyDocument } = await import(join(engine, "verify.js"))
loadEnv()
const [outDir, ...files] = process.argv.slice(2)
const api = new LawApi({ apiKey: process.env.KOREAN_LAW_OC || "" })
for (const f of files) {
  const t0 = Date.now()
  const { evidence, markdown } = await api.withBudget(400, () => verifyDocument(api, { text: readFileSync(f, "utf8"), asOf: process.env.AS_OF }))
  const dir = join(resolve(outDir), basename(f).replace(/\.md$/u, ""))
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "evidence.json"), JSON.stringify(evidence, null, 2))
  writeFileSync(join(dir, "evidence.md"), markdown + "\n")
  const cnt = {}
  for (const i of evidence.items) cnt[i.class] = (cnt[i.class] || 0) + 1
  console.log(basename(f), evidence.verdict, `${Date.now() - t0}ms`, JSON.stringify(cnt))
  for (const i of evidence.items.filter((x) => x.class !== "PASS")) console.log(`   ${i.class} ${i.status} ${i.cited}${i.needs_context ? " (문맥 확인)" : ""}`)
}
