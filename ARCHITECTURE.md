# How it works

Implementation notes for `note-reading`: the geometry, the scheduler, the
timing rules and the pitch detection. For what the drill is and how to use it,
see [README.md](README.md).

## Files

| File | |
| --- | --- |
| `notes.js` | Pitch model and staff geometry. Diatonic numbers, clefs, ranges. |
| `scheduler.js` | The algorithm. Pure functions over plain data. |
| `staff.js` | SVG: the staff, the inlined glyph outlines, the keyboard diagram. |
| `storage.js` | localStorage persistence, plus between-session decay. |
| `history.js` | Sessions and the windows over them. Pure functions. |
| `audio.js` | Microphone input: pitch detection and attack timing. Optional. |
| `midi.js` | Web MIDI input. Optional. |
| `app.js` | The trial loop, the controls and the record panel. |

Everything that can be a pure function over plain data is one, and lives in
`notes.js`, `scheduler.js` or `history.js` — which is what makes the
assertions in `tests.html` possible without a DOM.

The three glyphs in `staff.js` were extracted once from Bravura with fontTools
and pre-scaled into the staff's own coordinate system, where one staff space
is ten units and each glyph's origin sits on the line it refers to (G clef →
G4, F clef → F3). Inlined as path data rather than loaded as a webfont, so no
binary asset ships and nothing needs updating — and `inkExtent` can read a
glyph's vertical reach straight out of the path, which is what sizes the
view.

## The page

Two columns and a row underneath: the drill on the left, the record on the
right, the cheat sheet downstairs at full width.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                  │ CLEF   RANGE       LOWEST HIGHEST        │
│ NOTE READING [Name ▾][Play ▾]    │ [Both] [One ledger] [C4]  [A5]  Gunnar ▾ │
└─────────────────────────────────────────────────────────────────────────────┘
   ┌──────────────────────────┐      ┌──────────────────────────────┐
   │                          │      │ SESSION │ TODAY │ 7D │ 30D   │
   │          𝄞               │      │ 34 notes · 91% · 0.94s       │
   │   ───────●──────         │      │ 1.20s below middle C         │
   │          𝄢               │      │ F3 ██████████│ ×3  67% 1.80s │
   └──────────────────────────┘      │ C4 ███▌ (amber)  ×5 100% .70s│
     This is G3, not F3.             └──────────────────────────────┘
   ┌──────────────────────────┐
   │  C  D  E  F  G  A  H     │
   └──────────────────────────┘
─────────────────────────────────────────────────────────────────────────────
▾ CHEAT SHEET — 13 notes in play
```

The widths are worked backwards from the staff: the drill keeps 600px, which
leaves 556px of engraving inside the paper's padding, and the record takes 360
— enough for five columns of numbers and no more. The drill is capped there so
a wide window does not stretch it. Below 900px the page folds to a single
column in the same order.

**One bar, two groups.** The title at the window's left edge and the player
menu at its right, so the bar runs the full width where the page below it is
capped at the content column. Between them: the two decks, then — behind a
hairline rule — what the drill asks for, left to right in the order the
settings compose. Each field's label sits above its control, which is what
lets one bar hold the lot; it wraps to a second line by itself when the window
cannot.

**Each deck is a split button.** The deck is the button, and its caret opens
what that deck has to set up. Naming has one thing to set: whether the note
sounds when you answer. Playing has what it is being fed by — the MIDI
keyboard or the microphone, as two selectable rows, with `Tune` under them.
Neither menu is a mode.

Both menus, and the player's, are **popovers**. The browser draws them in its
own top layer, which is the whole reason to use one: a popover cannot be laid
out in the flow of the page, cannot be clipped by an ancestor, and needs no
z-index. The browser also closes it on a click elsewhere or on Escape, closes
any other one when a second opens, and handles focus.

The cost is the other half of the same fact: the top layer is not laid out by
the page either, so a popover with nothing said about it sits in the middle of
the window. `placeMenu` puts each one under the button it belongs to and back
inside the window, and again when the page scrolls. Browsers without the API
fall back to being hidden and shown in place. The one click that opens a menu
by itself is choosing `Play the notes` with nothing connected yet, that being
the click which asks for the microphone.

**The player menu** holds identity and the whole record: who is practising,
renaming, adding, export, import, and `Start over`. All of it rare, all of it
about whose record this is.

## The look

A jazz record's palette: a warm black room, one lit cream sheet, and red and
orange for everything that has to catch the eye. No third hue.

The two colours carry meaning rather than decorating. A slow note's bar is
deep red and shrinks toward the line it has to beat; a note inside that line
turns amber. A wrong answer is red and a right one amber, in the verdict and
on the notehead both — in the darker, higher-contrast pair that reads on cream
rather than the lighter pair used on black.

Three rules do most of the work:

- **No serif in the chrome.** The system sans does the controls; the serif
  survives only in the note names printed on the paper, where it belongs.
- **Filled, not outlined.** Controls are tints that brighten on hover, and the
  deck you are on is lit with the accent and a rule under it.
- **Real hierarchy.** 10px tracked caps for labels and tabs, 12–13px for
  chrome, 15–16px for the figures and the verdict.

The sheet is the only light surface on the page and needs no drop shadow to
say so. It is cream rather than white because a lit white rectangle in a dark
room glares, and because the drill is a thing printed on paper.

## How the scheduling works

Each note keeps an exponentially weighted average of your correct-answer
latency, an error rate, and how many times you've seen it. The chance of a
note coming up is proportional to

```
(ewma / 1000ms)² × (1 + 6 × errorRate) × (1 − e^(−gap / 3)) × (1 + (gap / 60)²)
```

The square matters: a linear weight barely separates a 700ms note from a
1400ms one, which is the distinction the whole thing exists to make. The last
factor is zero for a note just shown and climbs back over the next few trials,
so nothing ever repeats immediately — partly so the drill interleaves, partly
because a primed note's latency isn't a real measurement.

The middle factor is what getting a note wrong costs. `errorRate` is itself an
exponential average at `ALPHA`, so one miss on an otherwise clean note takes
it to 0.3 and the note's weight to 2.8× — enough to lift a note you answer in
700ms above one you answer correctly in 1.1s, though not above one that takes
2s. A note you miss every time is worth seven of the same speed you never
miss. The boost halves about every two correct answers and is gone within
eight: a miss should bring the note back soon, not for ever.

Errors are paid for here and nowhere else. A wrong answer could instead push
the latency average up, which would feed the squared term and bite much harder
— but that average is also what the session median and the bars report, and
those should keep meaning how fast you actually answer.

The last factor is the same gap read from the other end. The squared latency
term is the point of the whole thing, but it means a note you know well can
fall to a couple of percent of the draw and then sit out a whole sitting:
middle C at 600ms against notes averaging 1.4s is under 2% of the weight, so a
hundred notes will skip it entirely about one time in seven. Over 30,000
simulated trials the median gap between two middle Cs was 29 trials and the
worst was 248.

So recency suppresses what was just asked and starvation lifts what has been
waiting. The growth is unbounded on purpose — a bounded boost cannot overcome
a tenfold deficit, and it needs no bound, since being asked resets it. At
`STARVE_TAU = 60` the worst gap comes down to 131 and the 95th percentile to
80, while the slowest note is still asked five times as often as the fastest,
which is the ordering worth keeping. A note never asked at all is not starving
but new: an infinite gap contributes nothing here, and the explore floor has
it covered.

Notes seen fewer than three times get a weight floor, so the first minute
samples everything rather than fixating on whichever note happened to be slow.

Between sessions each average decays back toward the 2.5s prior at 8% a day.
Without that, a note you once answered quickly and have since forgotten would
never come up again.

This is deliberately not SM-2 or FSRS. Those schedule in intervals of days and
model the forgetting of discrete facts; this is a sub-second reflex over about
twenty items, most of them seen several times a minute. Nothing here has a due
date — every eligible note is in the draw on every trial, weighted.

Constants worth turning are at the top of `scheduler.js`: `TARGET_MS` is the
response time you're aiming for, `ALPHA` trades responsiveness against noise,
`ERROR_WEIGHT` sets how hard a miss counts, `RECENCY_TAU` how long a note
stays suppressed, `STARVE_TAU` how long one can be ignored, and
`DECAY_PER_DAY` how fast things go stale.

## The grand staff

With both clefs in play, both staves are drawn at all times, braced together,
with the note on whichever one it belongs to. Which means there is no clef to
notice changing — that is the point. A clef that changes silently while your
eye is on the notehead is a thing you have to remember rather than see, and no
amount of flashing the glyph at the edge of the staff fixes it.

The treble staff's lines run 0 to 40 and the bass staff's 80 to 120 — four
staff spaces apart, roughly what engraving uses. Each note is measured from
the staff it is written on: the treble from middle C up, the bass from H3
down. A reader anchors a note to the nearer staff rather than to the page, so
the gap can be whatever reads well; the cost is that where the two frames meet
the spacing is not uniform. C4 hangs a ledger line below the treble staff and
H3 sits in the space above the bass staff — a step apart in pitch, five staff
spaces apart on the page. Which is what piano music looks like.

What matters survives: **each pitch has exactly one position and no position
is two pitches**, checked over the whole compass. That is why ledger lines
occur in only three places on a grand staff — above the treble staff, below
the bass staff, and the one line middle C sits on, which is one ledger below
the treble staff and nothing to do with the bass.

**The cheat sheet makes one exception**, because the page does: where the
clefs' reaches overlap, piano music engraves a note on whichever staff suits
the hand taking it. `sharedNotes(clefNames, ledgers)` is that overlap —
nothing with the staves alone, middle C at one ledger line, A3 up to E4 at
two — and with both clefs in play the reference draws every one of them
twice, in one column under one name. Drawing a single spelling left a staff's
own ledger lines unused, lines you will certainly meet, and made the gap
between the staves read as a mistake rather than as the place the two frames
join. The drill still asks once; a card is a pitch.

At two ledger lines this has a consequence worth knowing: the staves'
extensions land on the same lines. The line at y=60 is E4 read against the
bass clef and A3 read against the treble, so the sheet shows two noteheads at
one height in neighbouring columns, meaning different notes. Which is what
clefs are for, and the best argument for drawing both spellings rather than
picking one.

**With one clef selected, one staff is drawn and every note goes on it**,
including the ones the ledger setting reaches past its ends. That is what
choosing one clef means: a bass-clef drill reaches C4 by way of ledger lines
over the bass staff, not by hanging it under a treble staff that has nothing
else on it. `clefFor(dn, clefNames)` answers the question once for the drill
and the cheat sheet both, and ledger lines are counted outwards from whichever
staff the note landed on. The assertions check that all three settings come
out evenly spaced throughout.

The view is sized to three things and not two: the staff lines, the notes on
them, and **the clefs' own outlines**. The G clef curls 13.9 units above the
line it names — a staff space and a half above the top of the treble staff —
and 26 below it, which is more than a margin measured from the lines would
allow; on the staves alone the top of the curl falls outside it. Those reaches
are read off the glyph outlines at load (`inkExtent`) rather than written down
beside them, since a hand-copied number goes stale the first time a glyph is
regenerated. The viewBox is also sized to the range in play, so a drill on the
staves alone isn't shrunk to leave room for ledger lines it will never use.

That also settles what a card is: on a grand staff `treble:C4` and `bass:C4`
are the same dot in the same place, so a card is keyed by pitch and deck, not
by clef. At two ledger lines the deck holds 29 notes. Clef-qualified ids from
before this are merged on load rather than orphaned — counts add, and the
averages pool by how much each was based on.

## Storage and sessions

Everything lives in this browser's `localStorage` and nowhere else. One roster
key, then four per player, so a trial's worth of writing touches a few hundred
bytes instead of rewriting every session ever played.

```
sightread.players.v1          { active, players: [{ id, name }] }
sightread.p.<id>.cards.v1     the scheduler's view: one card per deck and note
sightread.p.<id>.settings.v1  clef, range, limits, tuning offset, panels
sightread.p.<id>.sessions.v1  sittings that have ended
sightread.p.<id>.current.v1   the sitting in progress
```

Each player has their own everything: two people sharing a browser should not
share range limits, and they certainly should not share a record.

A **session** starts when you arrive at the page, and ends when you arrive
again, when you change deck, or after half an hour of silence. The one in
progress is kept on its own key and moved onto the list when it ends, so the
list grows by one at a time and is never rewritten. An empty session is
dropped rather than closed, so changing your mind before answering anything
leaves no trace.

**The first answer of a session is never timed.** The clock would be measuring
you finding the page and putting your hands on the keys. That is asked of the
session record — is there anything in it yet? — rather than tracked in a flag
beside it, because a flag has to be reset by everything that starts a session
and will eventually be missed by one of them. Reloading, a long gap and
changing decks all start sessions, and all get it right for free.

**Changing deck ends the session**, which is why a session only ever holds one
deck's notes. Not for tidiness: the first answer after moving from the laptop
keyboard to the piano is exactly the answer the rule above exists to throw
away, since it has finding the instrument in it. A sitting that mixed the two
could not be summarised as one thing either.

What is recorded is keyed by **how the answer was given**, not by which deck
was on show: `typed:C4` and `played:C4` are separate items, in the scheduler's
cards and in every session record. The panel filters to the deck you are
looking at — every span, including the comparison with the span before — so
the medians never mix a recognition time with a reach-for-the-key time.

The deck never changes on its own. Deriving it from the hardware meant a MIDI
keyboard announcing itself a second after load could switch decks and deal a
fresh note while you were still looking at the old one. A keyboard connecting
is only reported; `Play the notes` uses it if it is there rather than asking
for the microphone.

Per session, per note, the record keeps trials, how many were right first
time, and every correct-answer latency — about 1.5KB a session, so a few
hundred fit comfortably. Every latency rather than a running mean, because a
mean is not a median and there is no recovering one later. What is lost is the
order the trials came in.

`paintRecord` draws all four spans through one row builder and one summary
sentence, because they are the same question asked of different lengths of
time — a session that looked
like a different kind of thing from a month was the arrangement this replaced.
Every span, the session included, is read off the session record rather than
counted alongside it, so no two of them can disagree: `sessionTallies` folds
the sitting in progress, `history.sessionsIn` the rest.

A tab shows nothing when its deck has nothing over that span, asked of the
record rather than of a "has practice begun" flag — such a flag has to be
cleared on every deck change, and then four notes already named this session
vanish until you answer a fifth.

## Timing

The clock starts inside a double `requestAnimationFrame`, which puts it after
the frame is painted rather than when the DOM was mutated. Latencies below
120ms are clamped up: that is a key bouncing, not a reading.

Three kinds of answer are not timed at all, though they all still count as
answers. A wrong one, because how long you took to get it wrong says nothing
about how fast you can get it right. The correction that follows it, because
by then you have been told the answer. And anything over ten seconds, because
nothing was being measured but your absence — as with the first answer of a
sitting.

Discarded rather than clamped, which is the important part: one trip to the
kitchen on a note you answer in 700ms would pull its average to 2.9s, and
since the weight goes as the square, make it seventeen times more likely to be
asked. So a card counts trials, misses and measurements separately, and an
untimed trial moves the first two only.

Which matters for what gets shown. A note whose only answers went untimed
still has its average sitting at the 2.5s prior, and showing that as a time
would be reporting a number nobody measured. **A bar and a time need a
measurement; an accuracy needs only a trial** — so a note asked but never
timed shows one and not the other.

The session line reports a median for each half of the system — at and above
middle C, and below it — as well as the combined one. With both staves on
screen there is no clef to attribute a note to, but the hands still divide
about there, and one median for the pair hides which of them is dragging.

A row whose note is outside the current limits is faded, not dropped: the
record keeps what a span recorded, and the notes you practised before
narrowing the range are the ones you had least practice at, so they sort to
the top of the list and read as the worst problems you have — while being
unreachable. `paintNoteRows` asks `eligibleIds()`, which is the same set the
drill draws from, so the two cannot disagree.

Bars are medians of recorded trials, never the scheduler's own averages: those
fade on purpose, because their job is to decide what to ask next. They are
scaled to the slowest note in the set on show, with a line at the speed to aim
for, which makes them comparable within a panel and meaningless across two.
The numbers are there for that.

Amber is inside `TARGET_MS`, a second — worth aiming at without being the
destination. Quarter notes at a gentle 120bpm leave you 500ms a note, and you
have to be reading ahead of your hands, so playing at that tempo means
recognising notes well inside a half second: automatic rather than worked out.
A second is "I know this one and I am still thinking about it". The 2.5s prior
is "I am counting up from middle C". Playing wants longer than naming, so the
two decks aim at different numbers; the scheduler's own `TARGET_MS` stays one
number, because every weight is divided by it and the ratios between notes
come out the same either way.

Accuracy comes from plain counts rather than from `errorRate`: that one is an
exponential average, so a note you used to miss and now get right reads as
almost perfect within a few trials — the right behaviour for deciding what to
ask next, and a dishonest score. Four right out of five reads as 80% in the
column and 93% by error rate.

## Pitch detection

Answering from an acoustic piano asks two questions, and they want different
answers.

**What was played** is the McLeod pitch method over an 85ms window: the
normalised square difference function, then the first peak that comes within
90% of the tallest. Plain autocorrelation takes the tallest peak instead,
which on a piano is very often twice the true period, and an octave error is
the one mistake that would make answering this way useless. A spectral
peak-finder fares worse: piano partials are slightly inharmonic, and the
fundamental of a low note is frequently quieter than the harmonics above it.
Periodicity in the time domain survives both. `tests.html` synthesises a
piano-like tone for every note the drill can draw — once normally, once with
the fundamental at 15%, once with heavy inharmonicity — and checks that all of
them come back in the right octave.

Nothing is believed until the window holds the note and only the note. A
window still part full of the silence and hammer noise from before the attack
reads a half or a whole step out — measurably: at 17ms of note in an 85ms
window, three notes in twenty-nine come out beyond a whole step wrong, and by
34ms none do. Two frames agreeing is no defence, because consecutive frames
overlap by most of a window and will happily agree on the same wrong answer.
So the reading waits a full window after the attack, and wants a clarity of
0.7 rather than the 0.5 that merely means "some note or other".

**When it was played** cannot be the moment the pitch is known, which is a
good six frames later; timing it there would put all of that into every
latency. The attack is located inside the window instead, as the largest step
up in a block-wise envelope, and the answer is timestamped there. What remains
is the input latency of the sound card, which JavaScript cannot see. Against
the time it takes to move your hand to the key it is noise — and moving your
hand is the thing being measured anyway.

How loud a note has to be to count as one is not a fixed number. What reaches
the analyser depends on the microphone's gain, how far off the piano is and
how live the room is, and those vary by orders of magnitude between setups: a
level a close microphone crosses by breathing is one an upright across a room
never reaches. So the drill watches the room instead — quick to follow it
down, slow to follow it up, since the quiet moments are the evidence — and
asks a note to be three times that (`NOISE_MARGIN`). The meter on the
microphone's row reports both the level and the live threshold, so the
adaptation is visible rather than a black box.

The voice-call processing browsers apply to microphones by default is turned
off explicitly. Echo cancellation, noise suppression and automatic gain
control each wreck a piano, the last by riding over the attack the timing
depends on.

`Tune to my piano` medians three strikes of each of five keys, then medians
across the keys, and stores the result as `tuningCents` for `midiFor` to
subtract. Under 20 cents it reports concert pitch and stores nothing, because
below that
a single offset is the wrong model and the number would be false precision. A
piano does not have one offset: octaves are deliberately stretched, bass flat
and treble sharp by tens of cents at the extremes, so the deviation really
does differ by register. A string's sharp upper partials pull the period
estimate several cents sharp on their own, by a different amount per note. And
one strike's balance of partials moves it again — hence the three strikes.
What comes out alongside the result is the spread, which is the part worth
reading: notes disagreeing by more than the median are not measuring the
piano.

The readout says what it heard, how many cents off it was and how periodic the
window was, every time — so when it does get one wrong you can see which of
those three it was.

A reading more than 40 cents from any semitone is refused rather than rounded:
out of a possible fifty, that rejects only the outer fifth of each note's
window, where calling it either neighbour is a guess. A guess scored as an
answer is a wrong answer you did not play, and it moves the error rate for a
note you may well know.

## Tests

```
node tests/run.js
```

238 assertions and a boot test, in about a tenth of a second. The same
assertions run in a browser at `/tests.html`, which is a reporter around the
same module.

**Nothing is installed.** No `package.json`, no `node_modules`, no lockfile,
no `npx` — the npm registry is never contacted, and the Dockerfile installs
Node with weak dependencies off so the npm client is not even present. What
runs is node's own runtime plus five files in `tests/`:

| | |
| --- | --- |
| `assertions.js` | every assertion, as `run(report)`. Imported by `tests.html` and by `suite.js`, so the browser and the terminal cannot drift apart. |
| `dom-stub.js` | ~50 lines: an element that takes attributes, children and text. All the assertions need, because `staff.js` builds SVG. |
| `browser-stub.js` | the whole fiction — elements with classes and datasets, a document, localStorage, a clock, frame and timer queues, an AudioContext that records what it was asked to sound. For booting the app. |
| `suite.js` | imports every module (the syntax check), then runs the assertions. |
| `smoke.js` | boots `app.js` against the fiction, then answers six notes and checks the record follows. |
| `run.js` | runs the two suites, each in its own process. |

The modules are importable in Node with no stub at all, which is worth
knowing: none of them touches a browser API at module scope — every reference
to `document`, `localStorage` or `AudioContext` is inside a function. The
stubs are needed only when something is *called*.

What the assertions cover: the pitch model and every staff-geometry invariant
(one position per pitch, even spacing in each clef setting, the clefs'
outlines inside the view), the candidate sets and the pitch limits, the
card-id migrations, the scheduler's weighting and its error term, accuracy
counting, untimed answers, the history windows and their comparisons, and the
audio DSP against synthesised piano tones for every note the drill can draw.

The DSP assertions are the reason the suite is worth having: a change to
`analyse` or `attackIndex` that looks harmless shows up there as an octave
error on some low note with a weak fundamental, and nowhere else.

### On CI

`.github/workflows/build.yml` runs the suite on every push and pull request,
using the runner image's own Node — no `setup-node`, since the suite needs
nothing newer than Node 18 and installs nothing, and that is one fewer action
to pin.

Every action is pinned to a commit SHA with the tag in a trailing comment, and
there is exactly one of them: `actions/checkout`.

### What it cannot see

**CSS, entirely.** No layout, no visual state, no cascade. Every bug of that
kind — a menu that will not close, a control drawn in the wrong place, a rule
that reaches further than it means to — is invisible here and has to be found
by opening the page. A headless browser would close that gap and is the
obvious next step if it ever seems worth ~400MB of image.

`browser-stub.js` is also a fiction, and answers only the questions the app
asks. It proves the app boots, paints and records; it proves nothing about
what a real browser does with the same code.

## The DSP bench

`tools/dsp/` holds the Python that `audio.js` was designed against — a
transcription of the detector and two harnesses that sweep it over synthesised
notes. It is not part of the suite and the drill does not need it; it is how
the numbers quoted above were measured. See `tools/dsp/README.md`.
