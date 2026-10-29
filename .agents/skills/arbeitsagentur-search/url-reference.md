# Bundesagentur für Arbeit Jobsuche API Reference

The JSON API behind https://www.arbeitsagentur.de/jobsuche. Verified live on 2026-10-29.

## Access

- Header `X-API-Key: jobboerse-jobsuche`. This is the public client ID the website itself sends, not a credential.
- `robots.txt` on `rest.arbeitsagentur.de`: `Disallow:` (empty), `Allow: /`.
- Older paths (`pc/v4/jobs`) answer `403 No match found for request`. Search lives on **v6**, but job detail is still only on **v4**.

## Search

```
GET https://rest.arbeitsagentur.de/jobboerse/jobsuche-service/pc/v6/jobs
```

| Param | Meaning | Values |
|-------|---------|--------|
| `was` | Keywords | free text |
| `wo` | Place | city or postal code |
| `umkreis` | Radius around `wo` (km) | integer |
| `veroeffentlichtseit` | Published within N days | 0-100 |
| `arbeitszeit` | Working time | `vz` full-time, `tz` part-time, `snw` shift/night/weekend, `mj` minijob (`ho` returns 0 results; don't use it) |
| `befristung` | Contract | `1` temporary, `2` permanent |
| `angebotsart` | Offer type | `1` job, `2` self-employment, `4` apprenticeship, `34` internship/trainee |
| `page` | Page (1-indexed) | integer |
| `size` | Page size | up to 100 |

The response is `{ maxErgebnisse, page, size, woOutput, facetten, ergebnisliste: [...] }`.
Item fields used by the CLI:

| CLI field | BA field |
|-----------|----------|
| `id` | `referenznummer` |
| `title` | `stellenangebotsTitel` |
| `company` | `firma` |
| `location` | `stellenlokationen[].adresse.{plz,ort}` |
| `date` | `datumErsteVeroeffentlichung` (fallback `veroeffentlichungszeitraum.von`) |
| `occupation` | `hauptberuf` |
| `contract` | `vertragsdauer` (`UNBEFRISTET` / `BEFRISTET` / `KEINE_ANGABE`) |
| `startDate` | `eintrittszeitraum.von` |
| `salary` | `gehaltsspanneVon` / `gehaltsspanneBis` / `artDerVerguetung` |
| `homeOffice` | `homeofficemoeglich` |
| `externalUrl` | `externeURL` |

## Detail

```
GET https://rest.arbeitsagentur.de/jobboerse/jobsuche-service/pc/v4/jobdetails/<base64(referenznummer)>
```

Same fields as the search item, plus `stellenangebotsBeschreibung`: plain text with Markdown-style
`**bold**` and `\n` breaks. An unknown or expired reference number returns 404 with
`{"messages":[{"code":"STELLENANGEBOT_NICHT_GEFUNDEN"}]}`.

Public page for a posting: `https://www.arbeitsagentur.de/jobsuche/jobdetail/<referenznummer>`.
