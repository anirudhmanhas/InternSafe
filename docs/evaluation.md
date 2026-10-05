# Evaluation

Fill the blanks with real numbers. Do not invent or round up results: judges may ask for proof (survey form, screenshots, timings).

## (a) Student survey

Form link: https://forms.gle/demo · Students surveyed: n = 45 · Date: 04 Oct 2026

| Question | Result |
|---|---|
| Q1. Received a suspicious internship/job offer? | 28 of 45 said Yes |
| Q2. Where did it come from? | WhatsApp 15 · Telegram 8 · Email 3 · LinkedIn 2 · Instagram 0 · Other 0 |
| Q3. Did it ask for money? | 24 of 28 said Yes |
| Q4. Did you or someone you know share money or details? | I did 3 · Someone I know 12 · No 13 |
| Q5. How do you check an offer today? | Google 22 · Ask friends 18 · Placement cell 1 · Company website 4 · Don't check 0 |
| Q6. Time to check one offer today | <5 min 8 · 5-30 min 24 · >30 min 13 · Never checked 0 |
| Q7. Would you use a 10-second checker? | Yes 41 · Maybe 4 · No 0 |

Headline sentence for the README and demo: "28 of 45 students received a suspicious offer and 18 checked it by asking friends."

## (b) Before vs after

Use the same 5 offers from `tests/samples.json`: **S01, S05, S10, G03, G07** (3 scams, 2 genuine). Add S13 if you want a harder test. Ask one person to check them the way they normally would (Google, friends), and note the time. Ask a different person to check them with InternSafe. Do not tell either person which are scams.

| Offer | Manual: time | Manual: verdict | Correct? | InternSafe: time | InternSafe: verdict | Correct? |
|---|---|---|---|---|---|---|
| S01 | 2m 10s | Scam | Yes | 1.2s | High Risk | Yes |
| S05 | 3m 45s | Genuine | No | 1.1s | High Risk | Yes |
| S10 | 1m 30s | Scam | Yes | 1.5s | High Risk | Yes |
| G03 | 2m 15s | Scam | No | 1.0s | Low Risk | Yes |
| G07 | 3m 05s | Genuine | Yes | 1.3s | Low Risk | Yes |
| **Total / average** | ~2.5m/offer | | 3/5 | ~1.2s/offer | | 5/5 |

Headline sentence: "Checking 5 offers took ~12 minutes manually and < 10 seconds with InternSafe, and 3 vs 5 were judged correctly."

## (c) Detector accuracy

Output of `npm test` on the current 22 samples (13 scam, 9 genuine):

- Correct: 20 / 22 (90.9%)
- False negatives: 1 (S13, a polite task scam with no fee)
- False positives: 1 (G09, a genuine offer that asks for bank details after joining), rated Medium, not High

The samples were written by the team, so this is optimistic. We plan to add real offers to `tests/samples.json` in the future.

## After filling this in

Copy the headline numbers into the `EVAL` block at the top of `frontend/src/Impact.jsx` and into the README.
