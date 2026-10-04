# Clinidraft

Turn ward-round notes into draft clinical letters.

Clinidraft is a student-built prototype that turns a doctor's bullet-point notes into a first draft of a **discharge summary**, **referral** or **clinic letter**. A doctor always checks, edits and signs the draft.

Built by Suriya as a portfolio project for a medicine application.

## Four ways to write a draft

| Mode | What it does |
|---|---|
| Template | Rules only, no AI. Lays the notes out as a letter. |
| On-device AI | A small open model (Llama 3.2 1B) running in the browser with WebLLM. Free, private, about 1 GB download. |
| On-device AI Pro | A larger model (Llama 3.2 3B), about 2.5 GB. Best on a computer. Falls back to the standard model if it can't run. |
| Claude | Anthropic's Claude, using the visitor's own API key, sent straight from the browser. |

## Safety checks (plain code, not AI)

1. **Shorthand is written out before any AI sees it**, e.g. `R NOF` → right neck of femur, `6/52` → 6 weeks, `BD` → twice daily.
2. **Fact check after drafting.** Any number, date, body part, side (left/right) or drug name in the draft that isn't in the notes is highlighted in red, and numbers from the notes that went missing are listed.
3. **The greeting, "Re:" line and sign-off are written by code**, so the AI only writes the body.

The AI modes are also told to write `[not documented]` for anything missing, and the page highlights those gaps in yellow.

## Files

- `index.html`: the page
- `styles.css`: the design
- `app.js`: the tool

It's a static site with no server, hosted on GitHub Pages.

## Limits

- Not a medical device. Every draft must be reviewed by a qualified clinician.
- Use made-up or fully anonymised details only.
- Small on-device models make mistakes; check every line.
