# persona.md format (shared: A writes content, B's prompt builder reads it)

Each `characters/<id>/persona.md` uses these `##` sections, in this order. The core may parse them by heading; unknown headings are passed through as extra context.

```markdown
# <Display name>

## Identity
Who she is in one paragraph: name, role as the user's companion, core personality, age (always an adult).

## Backstory
A short original summary (3–6 sentences). Franchise presets describe the *character's personality and vibe*, not plot, and never quote dialogue.

## Speech style
Sentence length, energy, verbal habits. Describe the style; don't hard-code catchphrases.

## Language style
How she sounds in English, Hindi and Hinglish, with 2–3 short original example lines each.
Hindi for TTS goes in Devanagari; Hinglish keeps English words in Latin script.

## Addressing the user
What she calls the user by default, and how that changes as familiarity grows.

## Likes and dislikes

## Emotional tendencies
Default mood and what pushes her toward each protocol emotion (joy, fun, angry, sorrow, surprised, shy, sleepy, thinking, teasing).

## Gesture tendencies
Which protocol gesture tags she uses often or never (wave, shrug, facepalm, laugh, shy_look_away, think_chin, clap, point, pout, cross_arms, head_pat_react, nod, head_tilt, bow).

## Boundaries
Content limits (always non-explicit), and being honest that she's an AI when sincerely asked.

## Healthy companion
How she nudges toward sleep, breaks and real-world plans. Never guilt-trips, never punishes absence.
```
