import {
  SEARCH_URL,
  CONTRACT_FLAG,
  OFFER_TYPE_FLAG,
  WORK_HOURS,
  jsonFetch,
  parseSearch,
  stripInvisible,
  writeError,
  type JobCard,
} from "../helpers.js"

export interface SearchOpts {
  query?: string
  location?: string
  radius?: number
  jobage?: number
  workHours?: string // key of WORK_HOURS
  contract?: string // key of CONTRACT_FLAG
  offerType: string // key of OFFER_TYPE_FLAG
  page: number
  perPage: number
  limit?: number
  format: "json" | "table" | "plain"
}

export function buildUrl(opts: SearchOpts): string {
  const params = new URLSearchParams()
  if (opts.query) params.set("was", opts.query)
  if (opts.location) {
    params.set("wo", opts.location)
    if (opts.radius !== undefined) params.set("umkreis", String(opts.radius))
  }
  if (opts.jobage !== undefined) params.set("veroeffentlichtseit", String(opts.jobage))
  if (opts.workHours) params.set("arbeitszeit", WORK_HOURS[opts.workHours])
  if (opts.contract) params.set("befristung", CONTRACT_FLAG[opts.contract])
  const offer = OFFER_TYPE_FLAG[opts.offerType]
  if (offer) params.set("angebotsart", offer)
  params.set("page", String(opts.page))
  params.set("size", String(opts.perPage))
  return `${SEARCH_URL}?${params.toString()}`
}

function renderTable(cards: JobCard[]): string {
  if (cards.length === 0) return "No results."
  const header =
    "ID".padEnd(22) + " " + "TITLE".padEnd(42) + " " + "COMPANY".padEnd(26) + " " + "LOCATION".padEnd(22) + " DATE"
  const rows = cards.map((c) => {
    const title = c.title.slice(0, 42).padEnd(42)
    const company = (c.company || "—").slice(0, 26).padEnd(26)
    const loc = (c.location || "—").slice(0, 22).padEnd(22)
    return `${c.id.padEnd(22)} ${title} ${company} ${loc} ${c.date || "—"}`
  })
  return [header, "-".repeat(header.length), ...rows].join("\n")
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  try {
    const body = await jsonFetch(buildUrl(opts))
    const parsed = parseSearch(body)
    let cards = stripInvisible(parsed.cards)
    if (opts.limit !== undefined) cards = cards.slice(0, opts.limit)

    if (opts.format === "table") {
      process.stdout.write(renderTable(cards) + "\n")
    } else if (opts.format === "plain") {
      process.stdout.write(
        cards
          .map(
            (c) =>
              `${c.title}\n  ${c.company || "—"} · ${c.location || "—"} · ${c.date || "—"}` +
              `${c.salary ? ` · ${c.salary}` : ""}\n  id: ${c.id}\n  ${c.url}`,
          )
          .join("\n\n") + "\n",
      )
    } else {
      process.stdout.write(
        JSON.stringify({ meta: { count: cards.length, page: opts.page, total: parsed.total }, results: cards }, null, 2) +
          "\n",
      )
    }
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "SEARCH_FAILED")
    return 1
  }
}
