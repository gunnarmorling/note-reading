# Note reading

A sight-reading drill for the treble and bass clefs. It shows one note, times
how long you take to name it, and brings the slow ones back sooner.

Note names are German: the seventh degree is H, not B. Naturals only, so B —
which in that naming means B flat — is never an answer, and the B key is
unbound rather than taken as a synonym for H.

No dependencies, no build step. The clef and notehead outlines come from
[Bravura](https://github.com/steinbergmedia/bravura) (Steinberg, SIL OFL 1.1),
inlined in `staff.js`. How it works: [ARCHITECTURE.md](ARCHITECTURE.md).

## Running it

Module imports need an origin, so `file://` won't do. Any static server works:

```
jwebserver -p 8000        # JDK 18+
python3 -m http.server    # if you'd rather
```

Open `http://localhost:8000/`. **It has to be loopback**: over `http://` at a
hostname or an IP address the microphone is not refused but absent —
`navigator.mediaDevices` is undefined and no prompt ever appears. Use
`localhost`, or put a certificate in front of it.

Tests run two ways, and check the same things:

```
node tests/run.js         # in a terminal
```

or open `/tests.html` in the browser and read the page. No packages are
installed for either — see [ARCHITECTURE.md](ARCHITECTURE.md#tests).

## The two decks

**Name the notes** takes letters; **Play the notes** takes a MIDI keyboard or
an acoustic piano through the microphone, and checks the octave too.

They are separate records: separate weights, separate history, and separate
targets — a second for naming, a second and a half for playing. Pooled, a note
you can name but cannot find reads as mastered, and that gap is the one worth
seeing. The letter keys are dimmed on the playing deck, where they have
nothing to answer: a letter cannot say which octave.

Worth following: **one deck per sitting.** The same stimulus with two response
mappings carries a real switching cost. Changing deck starts a fresh session.

## What gets asked

Three controls compose. `Clef` picks one or both. `Range` adds ledger lines
either side of each staff, which sets how far the drill can reach at all.
`Lowest` and `Highest` clip that by pitch — early on, `Lowest: C4` is most of
what you want.

The limits offer only the notes the other two settings can draw: E2–A5 with
one ledger line, C2–C6 with two, G2–F5 with none (and a gap in the middle,
since neither staff reaches A3–E4 unaided). Change the clef or the range and
the limits follow as closely as the new set allows.

They can contradict each other without saying so: both clefs with nothing
below C4 is every note at or above middle C, all of them on the treble staff,
which leaves the bass staff empty and looks like a broken clef setting.

## Answering

Click the keys or press C through H. A MIDI keyboard in Chrome or Edge takes
over as the input (Safari has no Web MIDI); an acoustic piano works through
the microphone.

Get one wrong and the note stays until you answer it correctly. It has already
been scored — the first answer is the measurement, later attempts change
nothing and are not timed — so the wait is for the one moment the name you
have just been told and the note in front of you are both in view. If a note
turns out to be unanswerable, changing any setting moves the drill on.

`Hear the note when I answer`, in the naming deck's menu, sounds what you
typed at the octave nearest the note on screen. Off by default, and never
while the microphone is open: that would be a loop.

## Playing into a microphone

Choose `Microphone` in the playing deck's menu. Nothing is uploaded — there is
no network code in this app at all.

- **One note at a time**, letting the key come up in between. Two notes
  together are periodic at a third pitch and will be reported as that,
  confidently; with the pedal down, a note struck over a ringing one can come
  out as something neither of you played. Steady sounds are harmless: a note
  is only looked for on a rise in level, so a fan will never answer a trial.
- **Watch the meter** on the microphone's row. How loud a note must be is
  measured from the room, and the threshold is marked live. If the bar never
  reaches the mark, the microphone is closer to the room than to the piano.

`Tune to my piano` asks for five notes, three strikes each, and reports how
far off concert pitch you are. A piano untuned for years can sit half a
semitone flat, and past 50 cents every reading comes out a half step wrong —
which looks like a broken detector rather than a flat piano. Under 20 cents it
reports concert pitch and stores nothing.

## The record

Everything is in this browser's `localStorage`, one set per player, and
nowhere else. `Export` writes it to a file and `Import` reads one back, which
is also how a player moves between machines; import matches players by name
and replaces them wholesale rather than merging.

A **session** starts when you arrive at the page and ends when you arrive
again, change deck, or go half an hour without answering. There is nothing to
start or finish by hand. **The first answer of a session is never timed** — the
clock would be measuring you finding the keys.

The panel reads the record back over four spans: session, today, 7 days, 30
days. Rolling days, not calendar weeks. Two things about the rows are not
obvious:

- **A bar is that note's median against the slowest note in the same panel**,
  with a line at the speed to aim for. Comparable within a panel, meaningless
  between two.
- **A bar and a time need a measurement, an accuracy needs only a trial**, so
  a note that was asked and answered wrongly shows `0%` and no time. `×n` is
  how many times it came up — a couple of tries makes a rough median, so the
  longer spans hold the real numbers.

## Cheat sheet

The row under both columns shows the notes in play, named, on one grand staff;
on the playing deck it adds the same range on a keyboard. The toggle is
remembered.

Middle C appears twice, in one column: piano music writes it either below the
treble staff or above the bass, depending on which hand takes it, and both are
lines you will meet.

**Answers you look up still count.** A note read off the cheat sheet comes
back fast and correct, which the scheduler takes for fluency and stops showing
you. Use it between trials, not during one — or `Start over` in the player
menu after a session spent with it open.
