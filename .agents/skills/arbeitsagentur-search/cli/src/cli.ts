#!/usr/bin/env bun
// Self-contained CLI for the Bundesagentur für Arbeit Jobsuche API - Germany's
// official public job board (arbeitsagentur.de/jobsuche). No external CLI
// framework and zero runtime dependencies: it runs anywhere `bun` is available.

import { runSearch, type SearchOpts } from "./commands/search.js"
import { runDetail, type DetailOpts } from "./commands/detail.js"
import { CONTRACT_FLAG, OFFER_TYPE_FLAG, WORK_HOURS } from "./helpers.js"

interface Flags {
  _: string[]
  [k: string]: string | boolean | string[]
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { _: [] }
  const alias: Record<string, string> = { q: "query", l: "location", n: "limit" }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith("--") || a.startsWith("-")) {
      const key = alias[a.replace(/^-+/, "")] ?? a.replace(/^-+/, "")
      const next = argv[i + 1]
      if (next === undefined || next.startsWith("-")) {
        flags[key] = true
      } else {
        flags[key] = next
        i++
      }
    } else {
      ;(flags._ as string[]).push(a)
    }
  }
  return flags
}

const HELP = `arbeitsagentur-cli — search Germany's official job board (Bundesagentur für Arbeit)

USAGE
  bun run src/cli.ts search [flags]
  bun run src/cli.ts detail <refnr|url> [--format json|plain]

SEARCH FLAGS
  --query, -q <text>      Keywords ("was"): job title, skill, or employer. e.g. "Data Scientist".
  --location, -l <text>   City or postal code ("wo"). e.g. "Berlin", "München", "60311".
  --radius <km>           Radius around --location in km (1-200). Default: BA's own (25).
  --jobage <days>         Published within N days (1-100). Default: all.
  --work-hours <type>     ${Object.keys(WORK_HOURS).join(" | ")}.
  --contract <type>       ${Object.keys(CONTRACT_FLAG).join(" | ")}.
  --offer-type <type>     ${Object.keys(OFFER_TYPE_FLAG).join(" | ")}. Default: job.
  --page <n>              1-indexed page. Default 1.
  --per-page <n>          Results per page (1-100). Default 25.
  --limit, -n <n>         Cap results emitted (client-side).
  --format <fmt>          json (default) | table | plain.

EXAMPLES
  bun run src/cli.ts search -q "Data Scientist" -l Berlin --jobage 14 --format table
  bun run src/cli.ts search -q "Softwareentwickler" -l München --radius 30 --contract permanent --format table
  bun run src/cli.ts search -q "Machine Learning" --offer-type internship --format table
  bun run src/cli.ts detail 20390-978522636-S --format plain
`

const KNOWN_FLAGS: Record<string, Set<string>> = {
  search: new Set([
    "query", "location", "radius", "jobage", "work-hours", "contract", "offer-type",
    "page", "per-page", "limit", "format", "help", "h",
  ]),
  detail: new Set(["format", "help", "h"]),
}

function fail(error: string, code = "BAD_ARG"): number {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
  return 1
}

/** Whole number in [min, max], or null after writing the error. */
function intFlag(name: string, raw: string | boolean | string[], min: number, max: number): number | null {
  // Number(), not parseInt(): parseInt truncates "0.5" to 0 and silently
  // changes the filter.
  const val = typeof raw === "string" ? Number(raw.trim()) : NaN
  if (!Number.isInteger(val) || val < min || val > max) {
    fail(`--${name} must be a whole number from ${min} to ${max}, got "${raw}"`)
    return null
  }
  return val
}

/** A choice flag: its value must be a key of `table`, or null after writing the error. */
function choiceFlag(name: string, raw: string | boolean | string[], table: Record<string, unknown>): string | null {
  const v = typeof raw === "string" ? raw.trim().toLowerCase() : ""
  if (!(v in table)) {
    fail(`--${name} must be one of ${Object.keys(table).join("|")}, got ${typeof raw === "string" ? `"${raw}"` : "no value"}`)
    return null
  }
  return v
}

async function main(): Promise<number> {
  const flags = parseFlags(process.argv.slice(2))
  const cmd = (flags._ as string[])[0]

  if (!cmd || flags.help || flags.h) {
    process.stdout.write(HELP)
    return cmd ? 0 : 1
  }

  // Reject unknown flags: a discarded filter changes what the search returns
  // with no error.
  const knownFlags = KNOWN_FLAGS[cmd]
  if (knownFlags) {
    for (const key of Object.keys(flags)) {
      if (key === "_" || knownFlags.has(key)) continue
      return fail(
        `unknown flag --${key} for '${cmd}' - flags are never silently ignored, because a discarded filter changes what the search returns; see --help for the supported flags`,
        "UNKNOWN_FLAG",
      )
    }
  }

  if (cmd === "search") {
    // A present text flag needs a value: a bare -q (true) or -q "" would
    // otherwise search everything as if it matched.
    for (const name of ["query", "location"]) {
      const v = flags[name]
      if (v !== undefined && (typeof v !== "string" || !v.trim())) return fail(`--${name} requires a non-empty value`)
    }
    const fmt = flags.format !== undefined ? String(flags.format) : "json"
    if (!["json", "table", "plain"].includes(fmt)) return fail(`--format must be one of json|table|plain, got "${fmt}"`)
    if (flags.radius !== undefined && flags.location === undefined) {
      return fail("--radius needs --location (it is a radius around that place)")
    }

    const opts: SearchOpts = {
      query: typeof flags.query === "string" ? flags.query.trim() : undefined,
      location: typeof flags.location === "string" ? flags.location.trim() : undefined,
      offerType: "job",
      page: 1,
      perPage: 25,
      format: fmt as SearchOpts["format"],
    }
    const ints: [string, keyof SearchOpts, number, number][] = [
      ["radius", "radius", 1, 200],
      ["jobage", "jobage", 1, 100],
      ["page", "page", 1, 10000],
      ["per-page", "perPage", 1, 100],
      ["limit", "limit", 1, 10000],
    ]
    for (const [name, key, min, max] of ints) {
      if (flags[name] === undefined) continue
      const v = intFlag(name, flags[name], min, max)
      if (v === null) return 1
      ;(opts as unknown as Record<string, unknown>)[key] = v
    }
    const choices: [string, keyof SearchOpts, Record<string, unknown>][] = [
      ["work-hours", "workHours", WORK_HOURS],
      ["contract", "contract", CONTRACT_FLAG],
      ["offer-type", "offerType", OFFER_TYPE_FLAG],
    ]
    for (const [name, key, table] of choices) {
      if (flags[name] === undefined) continue
      const v = choiceFlag(name, flags[name], table)
      if (v === null) return 1
      ;(opts as unknown as Record<string, unknown>)[key] = v
    }
    return runSearch(opts)
  }

  if (cmd === "detail") {
    const id = (flags._ as string[])[1]
    if (!id) return fail("detail requires a <refnr|url>", "NO_ID")
    const fmt = flags.format !== undefined ? String(flags.format) : "json"
    if (!["json", "plain"].includes(fmt)) return fail(`--format must be one of json|plain, got "${fmt}"`)
    const opts: DetailOpts = { id, format: fmt as DetailOpts["format"] }
    return runDetail(opts)
  }

  return fail(`Unknown command "${cmd}"`, "BAD_CMD")
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    process.stderr.write(
      JSON.stringify({ error: e instanceof Error ? e.message : String(e), code: "INTERNAL_ERROR" }) + "\n",
    )
    process.exit(1)
  })
