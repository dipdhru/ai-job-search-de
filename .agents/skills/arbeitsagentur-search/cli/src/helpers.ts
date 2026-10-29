// Data source: the Bundesagentur für Arbeit (BA) Jobsuche REST API behind
// arbeitsagentur.de/jobsuche. No account needed: the API expects the public
// client ID `jobboerse-jobsuche` in an X-API-Key header, the same value the BA
// website sends from every visitor's browser - it is not a secret credential.
// Search returns JSON; detail takes the reference number base64-encoded.

export const SEARCH_URL = "https://rest.arbeitsagentur.de/jobboerse/jobsuche-service/pc/v6/jobs"
export const DETAIL_URL = "https://rest.arbeitsagentur.de/jobboerse/jobsuche-service/pc/v4/jobdetails"
export const PUBLIC_DETAIL_URL = "https://www.arbeitsagentur.de/jobsuche/jobdetail"

const PUBLIC_CLIENT_ID = "jobboerse-jobsuche"

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

const UA = "Mozilla/5.0 (compatible; arbeitsagentur-cli/1.0)"

/** Fetch JSON with exponential backoff on 429/5xx. Returns null on a 404. */
export async function jsonFetch(url: string): Promise<unknown | null> {
  const maxRetries = 6
  let delay = 500
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "application/json",
        "X-API-Key": PUBLIC_CLIENT_ID,
      },
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
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

/**
 * Clean a multi-line description: hidden markup goes first (a hidden element
 * can span line breaks), then each rendered line is cleaned on its own so the
 * paragraph structure survives the whitespace collapse.
 */
export function cleanMultiline(text: string): string {
  const withBreaks = visibleHtml(text)
    .replace(/\r\n?/g, "\n")
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
  occupation: string | null
  contract: string | null
  startDate: string | null
  salary: string | null
  homeOffice: boolean | null
  externalUrl: string | null
}

export interface JobDetail extends JobCard {
  description: string | null
  offerType: string | null
  isActive: boolean
}

type Raw = Record<string, unknown>

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? clean(v) : null)

function locationOf(raw: Raw): string | null {
  const locs = Array.isArray(raw.stellenlokationen) ? (raw.stellenlokationen as Raw[]) : []
  const places = locs
    .map((l) => {
      const a = (l?.adresse ?? {}) as Raw
      return [str(a.plz), str(a.ort)].filter(Boolean).join(" ")
    })
    .filter(Boolean)
  return places.length ? [...new Set(places)].join("; ") : null
}

const CONTRACT: Record<string, string> = { UNBEFRISTET: "permanent", BEFRISTET: "temporary" }

const SALARY_UNIT: Record<string, string> = {
  JAHRESGEHALT: "per year",
  MONATSGEHALT: "per month",
  STUNDENLOHN: "per hour",
}

function salaryOf(raw: Raw): string | null {
  const from = typeof raw.gehaltsspanneVon === "number" ? raw.gehaltsspanneVon : null
  const to = typeof raw.gehaltsspanneBis === "number" ? raw.gehaltsspanneBis : null
  if (from === null && to === null) return null
  const fmt = (n: number) => n.toLocaleString("de-DE")
  const unit = SALARY_UNIT[String(raw.verguetungsangabe)]
  const range = from !== null && to !== null ? `${fmt(from)}–${fmt(to)} EUR` : `${fmt((from ?? to) as number)} EUR`
  return unit ? `${range} ${unit}` : range
}

/** Map one BA result (search list item or detail record) to the shared portal shape. */
export function toCard(raw: Raw): JobCard | null {
  const id = str(raw.referenznummer)
  const title = str(raw.stellenangebotsTitel)
  if (!id || !title) return null
  const start = (raw.eintrittszeitraum ?? {}) as Raw
  const published = (raw.veroeffentlichungszeitraum ?? {}) as Raw
  return {
    id,
    title,
    company: str(raw.firma),
    location: locationOf(raw),
    date: str(raw.datumErsteVeroeffentlichung) ?? str(published.von),
    url: `${PUBLIC_DETAIL_URL}/${encodeURIComponent(id)}`,
    occupation: str(raw.hauptberuf),
    contract: CONTRACT[String(raw.vertragsdauer)] ?? null,
    startDate: str(start.von),
    salary: salaryOf(raw),
    homeOffice: typeof raw.homeofficemoeglich === "boolean" ? raw.homeofficemoeglich : null,
    externalUrl: str(raw.externeURL),
  }
}

export function parseSearch(body: unknown): { total: number | null; cards: JobCard[] } {
  const data = (body ?? {}) as Raw
  const list = Array.isArray(data.ergebnisliste) ? (data.ergebnisliste as Raw[]) : []
  const cards: JobCard[] = []
  // Map each item on its own so one malformed record cannot break the rest.
  for (const item of list) {
    try {
      const card = toCard(item)
      if (card) cards.push(card)
    } catch {
      continue
    }
  }
  return { total: typeof data.maxErgebnisse === "number" ? data.maxErgebnisse : null, cards }
}

const OFFER_TYPE: Record<string, string> = {
  ARBEIT: "job",
  AUSBILDUNG: "apprenticeship",
  PRAKTIKUM_TRAINEE: "internship/trainee",
  SELBSTAENDIGKEIT: "self-employment",
}

export function parseDetail(body: unknown, id: string): JobDetail | null {
  const raw = (body ?? {}) as Raw
  const card = toCard({ ...raw, referenznummer: raw.referenznummer ?? id })
  if (!card) return null
  const description =
    typeof raw.stellenangebotsBeschreibung === "string" ? cleanMultiline(raw.stellenangebotsBeschreibung) || null : null
  const published = (raw.veroeffentlichungszeitraum ?? {}) as Raw
  const until = str(published.bis)
  return {
    ...card,
    description,
    offerType: OFFER_TYPE[String(raw.stellenangebotsart)] ?? null,
    // The API serves a posting for as long as it is listed; an end date in
    // the past is the only closed marker it carries.
    isActive: !until || until >= new Date().toISOString().slice(0, 10),
  }
}

// Flag values -> BA query parameters. Every value the CLI accepts is listed
// here, so an unknown value is a validation error rather than a dropped filter.
export const WORK_HOURS: Record<string, string> = { fulltime: "vz", parttime: "tz", shift: "snw", minijob: "mj" }
export const CONTRACT_FLAG: Record<string, string> = { temporary: "1", permanent: "2" }
export const OFFER_TYPE_FLAG: Record<string, string | null> = {
  job: "1",
  "self-employment": "2",
  apprenticeship: "4",
  internship: "34",
  all: null,
}
