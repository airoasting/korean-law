/**
 * 패키지 루트의 .env(mcp/.env)를 읽어, 아직 설정되지 않은 환경변수만 채운다.
 * Claude Code·Codex가 서버를 다른 작업 폴더에서 띄워도 인증키를 찾게 하려고 실행 위치가 아니라 파일 위치를 기준으로 한다.
 * 플러그인 설정을 비워 둔 경우 빈 값이나 풀리지 않은 `${user_config.…}`가 들어오므로, 이것도 설정되지 않은 것으로 본다.
 */
import { existsSync, readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const unset = (value: string | undefined) => value === undefined || value.trim() === "" || /^\$\{.*\}$/u.test(value.trim())

export function loadEnv(file = resolve(dirname(fileURLToPath(import.meta.url)), "../.env")): void {
  for (const key of ["KOREAN_LAW_OC", "KOREAN_LAW_MAX_REQUESTS"]) if (unset(process.env[key])) delete process.env[key]
  if (!existsSync(file)) return
  for (const line of readFileSync(file, "utf8").split(/\r?\n/u)) {
    if (/^\s*(#|$)/u.test(line)) continue
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/u.exec(line)
    if (!m) continue
    const value = m[2].replace(/^(['"])(.*)\1$/u, "$2")
    if (process.env[m[1]] === undefined) process.env[m[1]] = value
  }
}
