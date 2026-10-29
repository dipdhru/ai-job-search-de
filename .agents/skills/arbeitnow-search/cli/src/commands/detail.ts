import { API_URL, cleanMultiline, jsonFetch, parsePage, stripInvisible, writeError, type JobDetail } from "../helpers.js"

export interface DetailOpts {
  id: string
  pages: number
  format: "json" | "plain"
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/i
const ARBEITNOW_HOST = /^(www\.)?arbeitnow\.com$/i

/** Accept a posting slug or an arbeitnow.com job URL; reject other hosts via real URL parsing. */
export function normalizeId(input: string): string | null {
  const trimmed = input.trim()
  if (SLUG.test(trimmed) && trimmed.includes("-")) return trimmed

  const hasScheme = /^https?:\/\//i.test(trimmed)
  if (hasScheme || /^[a-z0-9.-]+\.[a-z]{2,}(\/|$)/i.test(trimmed)) {
    let parsed: URL
    try {
      parsed = new URL(hasScheme ? trimmed : `https://${trimmed}`)
    } catch {
      return null
    }
    if (!ARBEITNOW_HOST.test(parsed.hostname)) return null
    const m = parsed.pathname.match(/\/jobs\/companies\/[^/]+\/([^/]+)\/?$/)
    return m && SLUG.test(m[1]) ? m[1] : null
  }
  return null
}

/**
 * The API has no per-posting endpoint, so detail scans the newest pages for
 * the slug. Postings older than the scanned window come back NOT_FOUND.
 */
export async function runDetail(opts: DetailOpts): Promise<number> {
  const id = normalizeId(opts.id)
  if (!id) {
    writeError(`Could not parse an Arbeitnow posting slug from "${opts.id}"`, "BAD_ID")
    return 1
  }
  try {
    let job: JobDetail | null = null
    for (let page = 1; page <= opts.pages && !job; page++) {
      const { postings, hasNext } = parsePage(await jsonFetch(`${API_URL}?page=${page}`))
      const hit = postings.find((p) => p.card.id === id)
      if (hit) job = { ...hit.card, description: cleanMultiline(hit.rawDescription) || null }
      if (!hasNext) break
    }
    if (!job) {
      writeError(
        `Posting not found in the newest ${opts.pages} page(s) - it may be older or expired; raise --pages (max 10) or open it on arbeitnow.com`,
        "NOT_FOUND",
      )
      return 1
    }
    const clean = stripInvisible(job)
    if (opts.format === "plain") {
      const lines = [
        clean.title,
        `${clean.company || "—"} · ${clean.location || "—"}${clean.remote ? " (remote)" : ""}`,
        "",
        clean.jobTypes.length ? `Job type: ${clean.jobTypes.join(", ")}` : "",
        clean.tags.length ? `Tags: ${clean.tags.join(", ")}` : "",
        clean.date ? `Published: ${clean.date}` : "",
        "",
        clean.description || "(no description)",
        "",
        `URL: ${clean.url}`,
      ].filter((l) => l !== "")
      process.stdout.write(lines.join("\n") + "\n")
    } else {
      process.stdout.write(JSON.stringify(clean, null, 2) + "\n")
    }
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "DETAIL_FAILED")
    return 1
  }
}
