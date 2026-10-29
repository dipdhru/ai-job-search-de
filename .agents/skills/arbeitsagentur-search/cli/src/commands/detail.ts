import { DETAIL_URL, jsonFetch, parseDetail, stripInvisible, writeError } from "../helpers.js"

export interface DetailOpts {
  id: string
  format: "json" | "plain"
}

// BA reference numbers: "20390-978522636-S", "12462-1647919-1-S",
// "15240-k50661.2040-S", "12265-291249_JB5283384-S", ...
const REFNR = /^\d{3,6}-[0-9A-Za-z._-]+$/
const BA_HOST = /(^|\.)arbeitsagentur\.de$/i

/**
 * Accept a raw reference number or an arbeitsagentur.de job-detail URL (with
 * or without scheme). A URL on any other host is rejected, read through real
 * URL parsing so look-alike hosts and userinfo tricks fall on the reject side.
 */
export function normalizeId(input: string): string | null {
  const trimmed = input.trim()
  if (REFNR.test(trimmed)) return trimmed

  const hasScheme = /^https?:\/\//i.test(trimmed)
  if (hasScheme || /^[a-z0-9.-]+\.[a-z]{2,}(\/|$)/i.test(trimmed)) {
    let parsed: URL
    try {
      parsed = new URL(hasScheme ? trimmed : `https://${trimmed}`)
    } catch {
      return null
    }
    if (!BA_HOST.test(parsed.hostname)) return null
    const m = parsed.pathname.match(/\/jobsuche\/jobdetail\/([^/]+)\/?$/)
    if (!m) return null
    const id = decodeURIComponent(m[1])
    return REFNR.test(id) ? id : null
  }
  return null
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  const id = normalizeId(opts.id)
  if (!id) {
    writeError(`Could not parse a BA reference number from "${opts.id}"`, "BAD_ID")
    return 1
  }
  try {
    const body = await jsonFetch(`${DETAIL_URL}/${Buffer.from(id).toString("base64")}`)
    const job = body === null ? null : parseDetail(body, id)
    if (!job) {
      writeError("Job not found (it may have expired)", "NOT_FOUND")
      return 1
    }
    const clean = stripInvisible(job)

    if (opts.format === "plain") {
      const lines = [
        clean.title,
        `${clean.company || "—"} · ${clean.location || "—"}`,
        "",
        clean.occupation ? `Occupation: ${clean.occupation}` : "",
        clean.offerType ? `Offer type: ${clean.offerType}` : "",
        clean.contract ? `Contract: ${clean.contract}` : "",
        clean.startDate ? `Start: ${clean.startDate}` : "",
        clean.salary ? `Salary: ${clean.salary}` : "",
        clean.date ? `Published: ${clean.date}` : "",
        `Status: ${clean.isActive ? "ACTIVE" : "CLOSED / EXPIRED"}`,
        "",
        clean.description || "(no description)",
        "",
        `URL: ${clean.url}`,
        clean.externalUrl ? `Employer page: ${clean.externalUrl}` : "",
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
