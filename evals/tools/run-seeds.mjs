// 엔진(mcp/)의 verify_document로 시드 전부를 실제 법제처 API에 돌려 evidence.json을 만든다.
// 사용: node evals/tools/run-seeds.mjs <출력폴더> [시드ID...]   (인증키는 mcp/.env, 기준일은 seeds.json의 as_of)
import { readFileSync, mkdirSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const engine = join(root, process.env.ENGINE || "mcp", "build")
const { loadEnv } = await import(join(engine, "env.js"))
const { LawApi } = await import(join(engine, "http.js"))
const { verifyDocument } = await import(join(engine, "verify.js"))
loadEnv()
const outDir = resolve(process.argv[2] ?? join(root, "evals/runs/latest"))
const only = new Set(process.argv.slice(3))
const seedFile = JSON.parse(readFileSync(join(root, "evals/seeds.json"), "utf8"))
const asOf = process.env.AS_OF || seedFile.as_of
const api = new LawApi({ apiKey: process.env.KOREAN_LAW_OC || "" })
for (const s of seedFile.seeds.filter((x) => !only.size || only.has(x.id))) {
  const t0 = Date.now()
  const { evidence, markdown } = await api.withBudget(400, () => verifyDocument(api, { text: s.text, asOf }))
  mkdirSync(join(outDir, s.id), { recursive: true })
  writeFileSync(join(outDir, s.id, "evidence.json"), JSON.stringify(evidence, null, 2))
  writeFileSync(join(outDir, s.id, "evidence.md"), markdown + "\n")
  const bad = evidence.items.filter((i) => i.class !== "PASS").map((i) => `${i.id}:${i.status}`)
  console.log(s.id, evidence.verdict, `${Date.now() - t0}ms`, bad.join(" "))
}
