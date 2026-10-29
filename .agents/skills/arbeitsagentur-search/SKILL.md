---
name: arbeitsagentur-search
version: 1.0.0
description: >
  Use this skill whenever the user wants to search for jobs in Germany, find job
  listings or vacancies in a German city or region, or look up a posting on the
  Bundesagentur für Arbeit job board (arbeitsagentur.de / Jobbörse / Jobsuche) -
  even if they don't name the portal. It is Germany's official public job board
  and covers private and public employers nationwide, plus internships,
  apprenticeships (Ausbildung) and working-student roles. Trigger phrases: jobs in
  Germany, German job search, find a job in Berlin / München / Hamburg / Frankfurt
  / Köln / Stuttgart, Jobsuche, Jobbörse, Arbeitsagentur, Bundesagentur für Arbeit,
  Stellenangebote, Stellenanzeige, offene Stellen, freie Stellen, Job finden, Jobs
  in Deutschland, Vollzeit, Teilzeit, unbefristet, befristet, Praktikum,
  Werkstudent, Ausbildung, Festanstellung, Referenznummer.
context: fork
enabled: true  # set to false to keep this portal installed but have /scrape skip it
allowed-tools: Bash(bun run .agents/skills/arbeitsagentur-search/cli/src/cli.ts *)
---

# Arbeitsagentur Search Skill

Search live listings from the **Bundesagentur für Arbeit (BA) Jobsuche**, Germany's
official job board, through the JSON API behind arbeitsagentur.de/jobsuche. On 2026-10-29 it
held about 820,000 active job postings (`angebotsart=1`) from private and public employers.

No account and no secret key are needed. The API expects the public client ID
`jobboerse-jobsuche` in an `X-API-Key` header, which is the same value the BA website
sends from every visitor's browser. The CLI adds it for you. `robots.txt` on
`rest.arbeitsagentur.de` allows all paths. Keep the volume to what a person searching for
themselves would do.

## When to use this skill

- Search for jobs in Germany by keyword, city or postal code, and radius
- Filter by publication age, full-time or part-time, permanent or temporary, and offer type
  (job, internship/trainee, apprenticeship, self-employment)
- Get the full description of a posting from its BA reference number (Referenznummer)

## Commands

### Search

```bash
bun run .agents/skills/arbeitsagentur-search/cli/src/cli.ts search [flags]
```

Key flags:
- `--query`/`-q <text>`: keywords (`was`). German and English titles both work, e.g. `"Data Scientist"`, `"Softwareentwickler"`.
- `--location`/`-l <text>`: city or postal code (`wo`), e.g. `Berlin`, `München`, `60311`.
- `--radius <km>`: radius around `--location` (1-200). Needs `--location`.
- `--jobage <days>`: published within N days (1-100).
- `--work-hours <type>`: `fulltime` | `parttime` | `shift` | `minijob`.
- `--contract <type>`: `permanent` (unbefristet) | `temporary` (befristet).
- `--offer-type <type>`: `job` (default) | `internship` | `apprenticeship` | `self-employment` | `all`.
- `--page <n>` (1-indexed), `--per-page <n>` (1-100, default 25), `--limit`/`-n <n>` (client-side cap).
- `--format json|table|plain`. The default is `json`.

There is no remote-work flag. The API has no working home-office filter (`arbeitszeit=ho`
returns nothing), but search results carry a `homeOffice` boolean when the employer set
one. To find remote roles, put "remote" or "Homeoffice" in `--query`.

### Detail

```bash
bun run .agents/skills/arbeitsagentur-search/cli/src/cli.ts detail <refnr|url> [--format json|plain]
```

Takes the `id` from a search result, which is the BA reference number such as `20390-978522636-S`,
or an `https://www.arbeitsagentur.de/jobsuche/jobdetail/<refnr>` URL. It returns the full
description, offer type, contract, start date, salary range (when given), and the employer's own
page (`externalUrl`) when the posting links one.

## Usage examples

```bash
# Data Scientist roles in Berlin, last 14 days
bun run .agents/skills/arbeitsagentur-search/cli/src/cli.ts search -q "Data Scientist" -l Berlin --jobage 14 --format table

# Permanent software roles within 30 km of Munich
bun run .agents/skills/arbeitsagentur-search/cli/src/cli.ts search -q "Softwareentwickler" -l München --radius 30 --contract permanent --format table

# ML internships / working-student roles nationwide
bun run .agents/skills/arbeitsagentur-search/cli/src/cli.ts search -q "Machine Learning" --offer-type internship --format table

# Part-time roles near a Frankfurt postal code
bun run .agents/skills/arbeitsagentur-search/cli/src/cli.ts search -q "Data Analyst" -l 60311 --radius 20 --work-hours parttime --format table

# Full posting
bun run .agents/skills/arbeitsagentur-search/cli/src/cli.ts detail 20390-978522636-S --format plain
```

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default. Use it for `/scrape` and for passing IDs between commands. |
| `table` | Quick comparisons |
| `plain` | Reading a single posting with `detail` |

JSON search output is `{ "meta": { "count", "page", "total" }, "results": [...] }`. Each result has
`id`, `title`, `company`, `location`, `date`, `url`, plus `occupation`, `contract`, `startDate`,
`salary`, `homeOffice` and `externalUrl`. Missing values are `null`. Errors go to stderr as
`{ "error", "code" }` and the CLI exits with code 1.

## Notes

- Titles carry the German gender marker `(m/w/d)`. It is a legal convention, not a filter.
- Most postings name no salary (`verguetungsangabe: KEINE_ANGABEN`), so `salary` is often `null`.
- Some postings are mirrored from private agencies (Personalvermittlung). The `company` is then the agency.
- An expired posting returns 404 from `detail`, and the CLI reports it as `NOT_FOUND`.
- Endpoint details and field mapping are in `url-reference.md`.
