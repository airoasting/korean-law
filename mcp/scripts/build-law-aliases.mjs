// 현행 법령 전체를 훑어 법제처가 정한 법령약칭명을 모으고 src/alias-data.ts 를 다시 쓴다.
// 사용: npm run aliases  (인증키는 .env 의 KOREAN_LAW_OC)
import { writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const { loadEnv } = await import(join(root, "build/env.js"))
const { LawApi } = await import(join(root, "build/http.js"))
const { searchLaws } = await import(join(root, "build/laws.js"))
loadEnv()
const api = new LawApi({ apiKey: process.env.KOREAN_LAW_OC || "" })

const pairs = new Map()
let total = 0
await api.withBudget(1000, async () => {
  for (let page = 1; ; page++) {
    const res = await searchLaws(api, { page, display: 100 })
    total = res.total
    for (const r of res.rows) if (r.name && r.abbr && r.abbr !== r.name) pairs.set(`${r.abbr}\u0000${r.name}`, [r.abbr, r.name])
    if (page * 100 >= total || !res.rows.length) break
  }
})
const rows = [...pairs.values()].sort((a, b) => a[0].localeCompare(b[0], "ko") || a[1].localeCompare(b[1], "ko"))
const today = new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10)
const body = rows.map(([a, o]) => `  [${JSON.stringify(a)}, ${JSON.stringify(o)}],`).join("\n")
writeFileSync(join(root, "src/alias-data.ts"),
  `/**\n * 법제처 국가법령정보센터 Open API 법령약칭명 (현행 법령 ${total}건 중 약칭 ${rows.length}건, ${today} 수집).\n` +
  ` * scripts/build-law-aliases.mjs 가 만든 파일이다. 손으로 고치지 말고 스크립트를 다시 돌린다.\n */\n` +
  `export const OFFICIAL_LAW_ALIASES: ReadonlyArray<readonly [string, string]> = [\n${body}\n]\n`)
console.log(`법령 ${total}건, 약칭 ${rows.length}건 → src/alias-data.ts`)
