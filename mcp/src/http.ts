/**
 * 법제처 국가법령정보센터 Open API 클라이언트.
 *
 * - 응답은 JSON(type=JSON)으로 받는다. HTML 안내 페이지 같은 비정상 응답은 오류로 올린다.
 * - 도구 호출 한 번이 쓸 수 있는 요청 수를 제한한다(withBudget). 넘으면 BudgetExceeded.
 * - 같은 요청은 1시간 동안 캐시한다. 캐시 키에는 인증키를 넣지 않는다.
 * - 오류 메시지에 인증키가 섞이지 않게 가린다.
 */
import { AsyncLocalStorage } from "node:async_hooks"

export const DRF_BASE = "https://www.law.go.kr/DRF"
export type Endpoint = "lawSearch.do" | "lawService.do"

export class BudgetExceeded extends Error {
  constructor() { super("요청 상한을 넘었다 (KOREAN_LAW_MAX_REQUESTS)") }
}

export class DrfError extends Error {}

interface Budget { left: number }

export interface LawApiOptions {
  apiKey: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
  retries?: number
  cacheTtlMs?: number
}

export class LawApi {
  private readonly budget = new AsyncLocalStorage<Budget>()
  private readonly cache = new Map<string, { at: number; value: unknown }>()
  private readonly fetchImpl: typeof fetch
  private readonly timeoutMs: number
  private readonly retries: number
  private readonly ttl: number

  constructor(private readonly opt: LawApiOptions) {
    this.fetchImpl = opt.fetchImpl ?? fetch
    this.timeoutMs = opt.timeoutMs ?? 20_000
    this.retries = opt.retries ?? 2
    this.ttl = opt.cacheTtlMs ?? 3_600_000
  }

  /** fn 안에서 일어나는 요청을 limit 회로 제한한다 */
  withBudget<T>(limit: number, fn: () => Promise<T>): Promise<T> {
    return this.budget.run({ left: limit }, fn)
  }

  get hasKey(): boolean {
    return !!this.opt.apiKey
  }

  mask(text: string): string {
    return this.opt.apiKey ? text.split(this.opt.apiKey).join("***") : text
  }

  async json(endpoint: Endpoint, params: Record<string, string | undefined>): Promise<any> {
    if (!this.opt.apiKey) throw new DrfError("법제처 인증키(KOREAN_LAW_OC)가 없다. 플러그인으로 설치했다면 /plugin configure korean-law@airoasting 에서 인증키를 넣고, 저장소를 받아 설치했다면 mcp/.env에 KOREAN_LAW_OC=인증키를 넣는다")
    const query = Object.entries(params).filter(([, v]) => v !== undefined && v !== "").sort(([a], [b]) => a.localeCompare(b))
    const key = `${endpoint}?${query.map(([k, v]) => `${k}=${v}`).join("&")}`
    const hit = this.cache.get(key)
    if (hit && Date.now() - hit.at < this.ttl) return hit.value

    const url = new URL(`${DRF_BASE}/${endpoint}`)
    url.searchParams.set("OC", this.opt.apiKey)
    url.searchParams.set("type", "JSON")
    for (const [k, v] of query) url.searchParams.set(k, String(v))

    let lastError: unknown
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      const b = this.budget.getStore()
      if (b) {
        if (b.left <= 0) throw new BudgetExceeded()
        b.left--
      }
      try {
        const value = await this.fetchOnce(url)
        this.cache.set(key, { at: Date.now(), value })
        return value
      } catch (error) {
        lastError = error
        if (error instanceof DrfError && !/HTTP (429|5\d\d)/u.test(error.message)) break
        if (attempt < this.retries) await new Promise((r) => setTimeout(r, 400 * (attempt + 1)))
      }
    }
    throw new DrfError(this.mask(lastError instanceof Error ? lastError.message : String(lastError)))
  }

  private async fetchOnce(url: URL): Promise<unknown> {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs)
    try {
      const res = await this.fetchImpl(url, {
        signal: ctrl.signal,
        headers: { "User-Agent": "Mozilla/5.0 (compatible; korean-law/1.0)", Accept: "application/json", Referer: "https://www.law.go.kr/" },
      })
      const text = await res.text()
      if (!res.ok) throw new DrfError(`법제처 응답 HTTP ${res.status}`)
      const trimmed = text.trim()
      if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
        throw new DrfError(`법제처가 JSON이 아닌 응답을 줬다: ${this.mask(trimmed.slice(0, 120))}`)
      }
      return JSON.parse(trimmed)
    } finally {
      clearTimeout(timer)
    }
  }
}

/** 단일 객체로 올 수도 있는 목록 필드를 배열로 */
export function list<T = any>(value: unknown): T[] {
  if (value === undefined || value === null || value === "") return []
  return (Array.isArray(value) ? value : [value]) as T[]
}

/** 문자열 또는 {content: ...} 꼴로 오는 필드를 문자열로 */
export function text(value: unknown): string {
  if (value === undefined || value === null) return ""
  if (typeof value === "string") return value
  if (typeof value === "number") return String(value)
  if (typeof value === "object" && "content" in (value as Record<string, unknown>)) return text((value as Record<string, unknown>).content)
  return ""
}
