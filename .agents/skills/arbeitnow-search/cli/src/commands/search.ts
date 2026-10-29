import {
  API_URL,
  jsonFetch,
  locationMatches,
  parsePage,
  queryMatches,
  stripInvisible,
  writeError,
  type JobCard,
} from "../helpers.js"

export interface SearchOpts {
  query?: string
  location?: string
  remote?: "only" | "exclude"
  match: "title" | "all"
  jobage?: number
  page: number // first API page to scan
  pages: number // how many API pages to scan
  limit?: number
  format: "json" | "table" | "plain"
}

function renderTable(cards: JobCard[]): string {
  if (cards.length === 0) return "No results."
  const header =
    "ID".padEnd(40) + " " + "TITLE".padEnd(40) + " " + "COMPANY".padEnd(22) + " " + "LOCATION".padEnd(18) + " DATE"
  const rows = cards.map((c) => {
    const loc = c.remote ? `${c.location || ""} (remote)`.trim() : c.location || "—"
    return [
      c.id.slice(0, 40).padEnd(40),
      c.title.slice(0, 40).padEnd(40),
      (c.company || "—").slice(0, 22).padEnd(22),
      loc.slice(0, 18).padEnd(18),
      c.date || "—",
    ].join(" ")
  })
  return [header, "-".repeat(header.length), ...rows].join("\n")
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  try {
    const cutoff = opts.jobage !== undefined ? Date.now() / 1000 - opts.jobage * 86400 : null
    const cards: JobCard[] = []
    // New postings arrive hourly and shift every page down, so a posting at
    // the end of one page can reappear at the top of the next during a scan.
    const seen = new Set<string>()
    let scanned = 0
    for (let page = opts.page; page < opts.page + opts.pages; page++) {
      const body = await jsonFetch(`${API_URL}?page=${page}`)
      const { postings, hasNext } = parsePage(body)
      scanned++
      let pastCutoff = false
      for (const p of postings) {
        // Pages are newest first, so once a posting is older than the window
        // no later page can hold a match.
        if (cutoff !== null && p.createdAt !== null && p.createdAt < cutoff) {
          pastCutoff = true
          continue
        }
        if (opts.query && !queryMatches(p, opts.query, opts.match === "all")) continue
        if (opts.location && !locationMatches(p.card.location, opts.location)) continue
        if (opts.remote === "only" && !p.card.remote) continue
        if (opts.remote === "exclude" && p.card.remote) continue
        if (seen.has(p.card.id)) continue
        seen.add(p.card.id)
        cards.push(p.card)
      }
      if (!hasNext || pastCutoff) break
      if (opts.limit !== undefined && cards.length >= opts.limit) break
    }
    const results = stripInvisible(opts.limit !== undefined ? cards.slice(0, opts.limit) : cards)

    if (opts.format === "table") {
      process.stdout.write(renderTable(results) + "\n")
    } else if (opts.format === "plain") {
      process.stdout.write(
        results
          .map(
            (c) =>
              `${c.title}\n  ${c.company || "—"} · ${c.location || "—"}${c.remote ? " (remote)" : ""} · ${c.date || "—"}` +
              `\n  id: ${c.id}\n  ${c.url}`,
          )
          .join("\n\n") + "\n",
      )
    } else {
      process.stdout.write(
        JSON.stringify({ meta: { count: results.length, page: opts.page, pagesScanned: scanned }, results }, null, 2) +
          "\n",
      )
    }
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "SEARCH_FAILED")
    return 1
  }
}
