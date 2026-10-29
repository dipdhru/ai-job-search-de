// Data source: Arbeitnow's free public job-board API (no key). It takes only a
// `page` parameter and returns 300 postings per page, newest first, so every
// filter here is applied client-side over a bounded number of pages.
// The API's own terms: "free public API for jobs, please do not abuse" - keep
// page scans small.

export const API_URL = "https://www.arbeitnow.com/api/job-board-api"

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

const UA = "Mozilla/5.0 (compatible; arbeitnow-cli/1.0)"

/** Fetch JSON with exponential backoff on 429/5xx. Returns null on a 404. */
export async function jsonFetch(url: string): Promise<unknown | null> {
  const maxRetries = 6
  let delay = 500
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      redirect: "follow",
      signal: AbortSignal.timeout(20000),
    })
    if (response.status === 429 || response.status >= 500) {
      if (attempt === maxRetries) {
        throw new Error(`Request failed: ${response.status} ${response.statusText}`)
      }
      const jitter = Math.floor(Math.random() * 500)
      await new Promise((r) => setTimeout(r, delay + jitter))
      delay = Math.min(delay * 2, 8000)
      continue
    }
    if (response.status === 404) return null
    if (!response.ok) {
      throw new Error(`Request failed: ${response.status} ${response.statusText}`)
    }
    return response.json()
  }
  throw new Error("Request failed after max retries")
}

/**
 * Convert a Unicode code point to a string. Uses `fromCodePoint` (not
 * `fromCharCode`) so supplementary-plane code points (e.g. emoji, U+1F600)
 * decode correctly, and drops out-of-range values instead of throwing.
 */
function numericEntity(cp: number): string {
  return cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : ""
}

export function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    // Numeric character references: decimal (&#233;) and hexadecimal (&#xE9;).
    .replace(/&#(\d+);/g, (_, dec) => numericEntity(parseInt(dec, 10)))
    .replace(/&#[xX]([0-9a-fA-F]+);/g, (_, hex) => numericEntity(parseInt(hex, 16)))
    .replace(/&nbsp;/g, " ")
}

/**
 * Characters a reader of the posting never sees but a model reading this
 * output does: C0/C1 controls other than tab, newline and carriage return, the
 * soft hyphen, bidi marks/embeddings/overrides/isolates, zero-width characters
 * and invisible operators, the BOM, variation selectors, and Unicode tag
 * characters (U+E0000-E007F), which can spell out a whole hidden instruction.
 * Listing text is third-party data, and these arrive raw in a portal's JSON or
 * markup as easily as through a numeric entity.
 */
const INVISIBLE_CHARS =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F­؜᠎​-‏‪-‮⁠-⁯︀-️﻿\u{E0000}-\u{E007F}\u{E0100}-\u{E01EF}]/gu

/** Strip INVISIBLE_CHARS from every string in a result, recursively: the CLI's output boundary. */
export function stripInvisible<T>(value: T): T {
  if (typeof value === "string") return value.replace(INVISIBLE_CHARS, "") as T
  if (Array.isArray(value)) return value.map(stripInvisible) as T
  if (value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, stripInvisible(v)])) as T
  }
  return value
}

const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"])

/** Whether an opening tag's attributes keep it from rendering: `hidden`, or an inline style that hides it. */
function isHiddenTag(attrs: string): boolean {
  for (const m of attrs.matchAll(/([^\s"'=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) {
    const name = m[1].toLowerCase()
    const value = m[2] ?? m[3] ?? m[4] ?? ""
    if (name === "hidden") return true
    if (name === "style" && /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden|mso-hide\s*:\s*all)\b/i.test(value)) {
      return true
    }
  }
  return false
}

/**
 * Drop markup a browser never renders - comments (including Word's
 * conditional ones), <script>/<style>/<template> blocks, and elements marked
 * hidden - before tags are stripped. A plain tag strip keeps their text, which
 * hands the model words the posting's reader never saw. CSS-only tricks
 * (off-screen, zero font size) need a renderer and are not caught here.
 */
export function visibleHtml(html: string): string {
  const src = html
    .replace(/<!--[\s\S]*?(?:-->|$)/g, "")
    .replace(/<(script|style|template)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, "")
  // One pass, collecting what is kept: slicing the string per hidden element
  // would make a page full of them quadratic.
  const open = /<([a-zA-Z][a-zA-Z0-9-]*)(\s[^>]*)?>/g
  const kept: string[] = []
  let from = 0
  let m: RegExpExecArray | null
  while ((m = open.exec(src)) !== null) {
    if (!m[2] || !isHiddenTag(m[2])) continue
    const tag = m[1].toLowerCase()
    let end = open.lastIndex
    if (!VOID_TAGS.has(tag) && !m[0].endsWith("/>")) {
      // Skip to the matching close tag, counting nested same-name elements. An
      // unclosed hidden element runs to the end: failing closed drops visible
      // text, failing open would leak the hidden text.
      const same = new RegExp(`<(/?)${tag}\\b[^>]*>`, "gi")
      same.lastIndex = end
      end = src.length
      let depth = 1
      let s: RegExpExecArray | null
      while ((s = same.exec(src)) !== null) {
        if (s[1]) depth--
        else if (!s[0].endsWith("/>")) depth++
        if (depth === 0) {
          end = same.lastIndex
          break
        }
      }
    }
    kept.push(src.slice(from, m.index))
    from = end
    open.lastIndex = end
  }
  kept.push(src.slice(from))
  return kept.join("")
}

function stripTags(html: string): string {
  return visibleHtml(html).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
}

export function clean(html: string): string {
  return decodeHtmlEntities(stripTags(html))
}

/** Multi-line clean: hidden markup first, then each rendered line on its own. */
export function cleanMultiline(html: string): string {
  const withBreaks = visibleHtml(html)
    .replace(/\s+/g, " ")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|li|ul|ol|div|h\d)>/gi, "\n")
  return withBreaks.split("\n").map(clean).join("\n").replace(/\n{3,}/g, "\n\n").trim()
}

export interface JobCard {
  id: string
  title: string
  company: string | null
  location: string | null
  date: string | null
  url: string
  remote: boolean
  tags: string[]
  jobTypes: string[]
}

export interface JobDetail extends JobCard {
  description: string | null
}

type Raw = Record<string, unknown>

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? clean(v) : null)
const strList = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(str).filter((s): s is string => s !== null) : []

export interface Posting {
  card: JobCard
  rawDescription: string
  createdAt: number | null
}

/** Map one API item; null when it lacks an id or title. */
export function toPosting(raw: Raw): Posting | null {
  const id = str(raw.slug)
  const title = str(raw.title)
  if (!id || !title) return null
  const created = typeof raw.created_at === "number" ? raw.created_at : null
  const url = str(raw.url)
  // Only links on the portal itself: the posting's own url field is third-party data.
  if (!url || !/^https:\/\/www\.arbeitnow\.com\//.test(url)) return null
  return {
    card: {
      id,
      title,
      company: str(raw.company_name),
      location: str(raw.location),
      date: created !== null ? new Date(created * 1000).toISOString().slice(0, 10) : null,
      url,
      remote: raw.remote === true,
      tags: strList(raw.tags),
      jobTypes: strList(raw.job_types),
    },
    rawDescription: typeof raw.description === "string" ? raw.description : "",
    createdAt: created,
  }
}

export function parsePage(body: unknown): { postings: Posting[]; hasNext: boolean } {
  const data = (body ?? {}) as Raw
  const list = Array.isArray(data.data) ? (data.data as Raw[]) : []
  const postings: Posting[] = []
  // Map each item on its own so one malformed record cannot break the rest.
  for (const item of list) {
    try {
      const p = toPosting(item)
      if (p) postings.push(p)
    } catch {
      continue
    }
  }
  const links = (data.links ?? {}) as Raw
  return { postings, hasNext: typeof links.next === "string" && list.length > 0 }
}

/** Lower-case and fold German umlauts and other diacritics, so "München", "Muenchen" and "MUENCHEN" compare equal. */
export function fold(s: string): string {
  return s
    .toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
}

// Places with a common English and German spelling.
const PLACE_ALIASES: Record<string, string[]> = {
  muenchen: ["munich"], munich: ["muenchen"],
  koeln: ["cologne"], cologne: ["koeln"],
  nuernberg: ["nuremberg"], nuremberg: ["nuernberg"],
  germany: ["deutschland"], deutschland: ["germany"],
}

export function locationMatches(location: string | null, wanted: string): boolean {
  const have = fold(location ?? "")
  const w = fold(wanted.trim())
  return [w, ...(PLACE_ALIASES[w] ?? [])].some((alt) => have.includes(alt))
}

/** Every query word must appear in the title, company, or tags (and the description when asked). */
export function queryMatches(p: Posting, query: string, inDescription: boolean): boolean {
  const hay = fold(
    [p.card.title, p.card.company ?? "", ...p.card.tags, inDescription ? clean(p.rawDescription) : ""].join(" "),
  )
  return fold(query).split(/\s+/).filter(Boolean).every((word) => hay.includes(word))
}
