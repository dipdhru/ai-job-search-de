# Arbeitnow API Reference

Verified live on 2026-10-29. Arbeitnow's blog post at https://www.arbeitnow.com/blog/job-board-api describes the API.

## Endpoint

```
GET https://www.arbeitnow.com/api/job-board-api?page=<n>
```

- You don't need a key. `robots.txt` contains `Disallow:` (empty) and `Disallow: /*?__hstc` only.
- 300 postings per page, ordered by `created_at` descending, updated hourly. A page is about 1.7 MB.
- `meta.terms`: free public API, "please do not abuse", link back appreciated.
- Pagination: `links.next` is a URL, or `null` on the last page.
- Undocumented `remote=true` / `visa_sponsorship=true` change the results but do not filter them reliably, so they are unused.

## Item fields

| CLI field | API field |
|-----------|-----------|
| `id` | `slug` |
| `title` | `title` |
| `company` | `company_name` |
| `location` | `location` (free text, may list several cities separated by `;`) |
| `date` | `created_at` (unix seconds) as a YYYY-MM-DD string |
| `url` | `url` (kept only when it is on `https://www.arbeitnow.com/`) |
| `remote` | `remote` (boolean) |
| `tags` | `tags` |
| `jobTypes` | `job_types` |
| `description` (detail only) | `description` (HTML) |

Public posting URL: `https://www.arbeitnow.com/jobs/companies/<company-slug>/<slug>`.
