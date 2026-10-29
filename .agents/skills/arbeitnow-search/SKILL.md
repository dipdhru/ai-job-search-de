---
name: arbeitnow-search
version: 1.0.0
description: >
  Use this skill whenever the user wants English-friendly jobs in Germany or Europe,
  tech and startup roles in Berlin, Munich, Hamburg or other German cities, remote
  jobs open to Germany, or a posting on arbeitnow.com. Arbeitnow aggregates postings
  from company applicant-tracking systems (Greenhouse, Lever, Personio, ...), so it
  carries many international and English-language roles that the official
  Arbeitsagentur board lists late or not at all. Trigger phrases: English jobs in
  Germany, jobs in Berlin for English speakers, startup jobs Germany, tech jobs
  Germany, remote jobs Europe, visa sponsorship Germany, arbeitnow, Jobs auf
  Englisch, englischsprachige Jobs, Stellen in Berlin, Startup-Jobs.
context: fork
enabled: true  # set to false to keep this portal installed but have /scrape skip it
allowed-tools: Bash(bun run .agents/skills/arbeitnow-search/cli/src/cli.ts *)
---

# Arbeitnow Search Skill

Searches [Arbeitnow](https://www.arbeitnow.com) through its free public job-board API. You
don't need a key. `robots.txt` allows the API. The API's own terms say it is "free" and ask
users "please do not abuse", so keep scans small.

**How it searches:** the API takes no search parameters. It only returns pages of 300
postings, newest first, and each page covers about 1.5 days of postings. The CLI scans
`--pages` pages (3 by default) and filters them locally. Matches are therefore limited to
recent postings. That suits `/scrape`, which looks for new jobs, but this skill can't search
the full history.

The board covers Europe, not only Germany: London, Paris and Zürich postings appear too. Pass
`--location` to narrow to German cities.

## Commands

### Search

```bash
bun run .agents/skills/arbeitnow-search/cli/src/cli.ts search [flags]
```

- `--query`/`-q <text>`: every word must appear in the title, company or tags. Use this mode for job titles. For skills such as `python` or `kubernetes`, which rarely appear in titles, add `--match all` to also search descriptions.
- `--location`/`-l <text>`: a substring of the location. Umlauts are folded, and the aliases Munich/München, Cologne/Köln and Nuremberg/Nürnberg match each other.
- `--remote only|exclude`: filter on the posting's remote flag.
- `--jobage <days>`: posted within N days (1-30). Scanning stops at the cutoff.
- `--pages <n>`: pages to scan (1-10, default 3). `--page <n>`: first page to scan (default 1).
- `--limit`/`-n <n>`, `--format json|table|plain`.

### Detail

```bash
bun run .agents/skills/arbeitnow-search/cli/src/cli.ts detail <slug|url> [--pages <n>] [--format json|plain]
```

There is no per-posting endpoint, so `detail` scans the newest `--pages` pages (5 by default)
for the slug. For an older posting, open its arbeitnow.com URL with WebFetch instead.

## Usage examples

```bash
# Python roles in Berlin: a skill rarely appears in titles or tags, so match descriptions too
bun run .agents/skills/arbeitnow-search/cli/src/cli.ts search -q python -l Berlin --match all --format table

# Data Scientist titles anywhere, recent postings
bun run .agents/skills/arbeitnow-search/cli/src/cli.ts search -q "data scientist" --format table

# Remote data-engineering roles from the last 3 days
bun run .agents/skills/arbeitnow-search/cli/src/cli.ts search -q "data engineer" --remote only --jobage 3 --format table

# Anything in Munich mentioning machine learning anywhere in the posting
bun run .agents/skills/arbeitnow-search/cli/src/cli.ts search -q "machine learning" --match all -l München --format table

# A wider scan (about two weeks of postings) for a rare skill
bun run .agents/skills/arbeitnow-search/cli/src/cli.ts search -q "geophysics" --match all --pages 10 --format table

# Full posting
bun run .agents/skills/arbeitnow-search/cli/src/cli.ts detail <slug> --format plain
```

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default. Used by `/scrape`. |
| `table` | Quick comparisons |
| `plain` | Reading a single posting with `detail` |

JSON search output is `{ "meta": { "count", "page", "pagesScanned" }, "results": [...] }`. Each
result has `id` (the slug), `title`, `company`, `location`, `date`, `url`, `remote`, `tags` and
`jobTypes`. Errors go to stderr as `{ "error", "code" }` and the CLI exits with code 1.

## Notes

- The API takes no filter parameters besides `page`. Probing showed that `remote=true` and
  `visa_sponsorship=true` change the result set, but they don't filter it reliably, so the CLI
  doesn't send them.
- Descriptions are employer HTML. They are run through the hidden-markup and invisible-character
  filters before output.
- Endpoint notes are in `url-reference.md`.
