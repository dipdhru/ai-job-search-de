#!/usr/bin/env bun
// Self-contained CLI for Arbeitnow's free public job-board API - English-friendly
// jobs in Germany and Europe, many with visa sponsorship or remote options. No
// external CLI framework and zero runtime dependencies.

import { runSearch, type SearchOpts } from "./commands/search.js"
import { runDetail, type DetailOpts } from "./commands/detail.js"

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

const HELP = `arbeitnow-cli — search Arbeitnow (jobs in Germany and Europe, English-friendly)

USAGE
  bun run src/cli.ts search [flags]
  bun run src/cli.ts detail <slug|url> [--pages <n>] [--format json|plain]

The API has no server-side search: each call scans --pages pages of 300
postings (newest first, about 1.5 days of postings per page) and filters them
here. Keep scans small - the API is free and asks not to be abused.

SEARCH FLAGS
  --query, -q <text>      Every word must appear in the title, company, or tags.
  --match <where>         title (default: title/company/tags) | all (also the description).
  --location, -l <text>   Substring of the posting's location; umlauts and
                          Munich/München, Cologne/Köln aliases are folded.
  --remote <mode>         only | exclude.
  --jobage <days>         Posted within N days (1-30). Stops scanning at the cutoff.
  --pages <n>             API pages to scan (1-10). Default 3.
  --page <n>              First API page to scan. Default 1.
  --limit, -n <n>         Cap results emitted.
  --format <fmt>          json (default) | table | plain.

EXAMPLES
  bun run src/cli.ts search -q "python" -l Berlin --match all --format table
  bun run src/cli.ts search -q "data engineer" --remote only --jobage 3 --format table
  bun run src/cli.ts detail junior-operations-specialist-berlin-8290 --format plain
`

const KNOWN_FLAGS: Record<string, Set<string>> = {
  search: new Set(["query", "match", "location", "remote", "jobage", "pages", "page", "limit", "format", "help", "h"]),
  detail: new Set(["pages", "format", "help", "h"]),
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
    for (const name of ["query", "location"]) {
      const v = flags[name]
      if (v !== undefined && (typeof v !== "string" || !v.trim())) return fail(`--${name} requires a non-empty value`)
    }
    const fmt = flags.format !== undefined ? String(flags.format) : "json"
    if (!["json", "table", "plain"].includes(fmt)) return fail(`--format must be one of json|table|plain, got "${fmt}"`)

    const opts: SearchOpts = {
      query: typeof flags.query === "string" ? flags.query.trim() : undefined,
      location: typeof flags.location === "string" ? flags.location.trim() : undefined,
      match: "title",
      page: 1,
      pages: 3,
      format: fmt as SearchOpts["format"],
    }
    const ints: [string, keyof SearchOpts, number, number][] = [
      ["jobage", "jobage", 1, 30],
      ["pages", "pages", 1, 10],
      ["page", "page", 1, 1000],
      ["limit", "limit", 1, 10000],
    ]
    for (const [name, key, min, max] of ints) {
      if (flags[name] === undefined) continue
      const v = intFlag(name, flags[name], min, max)
      if (v === null) return 1
      ;(opts as unknown as Record<string, unknown>)[key] = v
    }
    const choices: [string, keyof SearchOpts, Record<string, unknown>][] = [
      ["remote", "remote", { only: 1, exclude: 1 }],
      ["match", "match", { title: 1, all: 1 }],
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
    if (!id) return fail("detail requires a <slug|url>", "NO_ID")
    const fmt = flags.format !== undefined ? String(flags.format) : "json"
    if (!["json", "plain"].includes(fmt)) return fail(`--format must be one of json|plain, got "${fmt}"`)
    let pages = 5
    if (flags.pages !== undefined) {
      const v = intFlag("pages", flags.pages, 1, 10)
      if (v === null) return 1
      pages = v
    }
    const opts: DetailOpts = { id, pages, format: fmt as DetailOpts["format"] }
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
