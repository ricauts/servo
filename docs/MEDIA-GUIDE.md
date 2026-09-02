# The media rig — how the README's images are made (hyg-09)

`scripts/media/` is the recording studio: the scripts that produce every
committed image and film in this repository. Nothing here runs in CI, no
media dependency is declared in `package.json`, and every optional module
is a guarded dynamic import — a missing one is a message with the exact
`npm i --no-save <module>` command, never a stack trace.

## What each script produces, and which committed artifact it regenerates

| script | produces | regenerates |
|---|---|---|
| `readme-screenshots.mjs` | the desk's UI stills | `docs/assets/screenshot-{dashboard,tickets,ticket-detail,approvals,agents,integrations,settings,mobile}.png` (the README stills) |
| `make-before-after.mjs` | the before/after figure from a ticket's two attachments | `docs/assets/before-after-fix.png` |
| `shoot-og.mjs` | the Open Graph card at exactly 1200x630 | `assets/og-card.png` **inside the servoai-site repository** (its site directory is a REQUIRED argument — see below) |
| `record-hero.mjs` | HERO-FILM, one full desk loop, pixel-identical start and end | the landing page's hero film |
| `record-approval.mjs` | the approval-flow capture | the approvals still / film source |
| `record-cursor.mjs` | the synthetic cursor helper | (imported by the recorders, not run directly) |
| `screenshot.mjs` | the generic one-page capture the above share | (helper) |
| `make-capture-db.mjs` | `servo_capture`, the throwaway copy of the working database | nothing committed — rebuilt before every take |

## The capture privacy rules `make-capture-db.mjs` encodes

The redaction statements in that script are the rules, and they are
non-negotiable for any take:

- **no real person, address or domain anywhere on screen** — names become
  role placeholders, domains become `internal.invalid`, addresses become
  the 192.0.2.x documentation range;
- no real credential, and no path to a paid model call — recordings run
  against the mock provider with no per-agent credentials;
- English only (the working database has Spanish ticket titles);
- ticket #1061 staged mid-flight: workable, reply draft pending.

The script takes NO database-path argument at all: it reads the working
database through `docker compose exec db` and writes only `servo_capture`.
It may **never** be pointed at the dev or demo database (loop-guard's
rail 1 refuses those names; `npm run demo` wipes in place and is
deliberately not used). The pre-Postgres hardcoded default path died with
the cutover (db-07); hyg-09 records that the criterion "no
default path" is now met by the stronger fact that no path argument
exists.

`shoot-og.mjs`'s site directory is a REQUIRED argument with no default:
the loop may never commit to the servoai-site repository, so no script of
ours may carry a default path into it.

## The optional-dependency policy (machine-readable)

The fenced block below lists the modules `scripts/media/**` may import
without declaring them in `package.json`. `scripts/repo-refs.mjs` reads
this block (hyg-04's check): each is a guarded dynamic import via
`scripts/media/_deps.mjs`, so a missing module exits 1 with the exact
`npm i --no-save <module>` command instead of a stack trace, and CI never
downloads a 30 MB ffmpeg for tooling nobody runs there.

```media-imports
# modules scripts/media/** may import without declaring (hyg-09)
sharp
ffmpeg-static
```
