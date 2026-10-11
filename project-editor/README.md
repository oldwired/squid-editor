# SQUID project editor

A local browser editor for SQUID Manager `.prj` files. Open `index.html` in a
browser, or serve this directory from the repository root:

```sh
python3 -m http.server 8766 --bind 127.0.0.1 --directory project-editor
```

Visit <http://127.0.0.1:8766/>. The welcome screen offers **New project**,
**Open .prj**, **Read from SQUID**, and an original editor example generated locally from code.
Use **File → Open .prj** or drop an export. **New** creates 16 tracks on USB
channels 1–16 and one empty pattern. **Export .prj** requests a timestamped
download. Check that it arrived before closing the tab. The close warning remains
active for edits since opening, even after an export request.

There are no dependencies or cloud storage. Files and USB transfers stay local.
Separate **Recovery**, **MIDI input**, and **SQUID** controls at the top show
their current states. SQUID connects directly to the hardware in Chrome/Chromium.

## USB projects

Serve the editor on localhost as above, or HTTPS. Connect the SQUID by USB, close
SQUID Manager, and choose **SQUID → Connect**. Select TORAIZ SQUID in the browser's
HID device picker. The panel lists saved projects and free project/pattern capacity.
**Open in editor** reads a selected project into the editor; **Save .prj** requests
a timestamped backup download. Check that the browser saved the download.
The current-project label appears only when the device's current ID is saved.

**Send editor project…** reviews a snapshot, then **Send project to SQUID** checks
capacity, transfers the header and patterns, and waits for the device's save
confirmation. Editing invalidates the review. The selected list row controls
downloads; it does not select an upload destination. SQUID's own load operation
chooses that destination. A new two-pattern editor project was accepted live and
allocated ID 3, despite an input header ID of 0 and a different selected list row.
Read-back preserved every pattern byte and all header data except project ID,
serial and occupied sector IDs. This verifies one new-project upload on the
connected device; replacing existing projects and allocation on other firmware
versions have not been exercised.

Cancel finishes the current page and aborts an active transfer. A cancelled read
does not open or download the received project, including cancellation while
awaiting the final completion response. Cancellation is unavailable during the
final save. Save confirmation remains visible if the subsequent project-list
refresh fails; use **Refresh** or reconnect to update the list. Closing/reloading during a
transfer triggers the browser's leave warning. CRC, ordering, send/response
timeouts and disconnect errors stop the operation; reconnect before retrying a
wire error. Open only one hardware connection at a time. No device deletion,
renaming, current-pattern transfer or firmware updating is offered in this panel.
Safari/Firefox can still edit files; hardware access needs desktop Chromium's
[WebHID API](https://developer.chrome.com/docs/capabilities/hid).

## Editing

- Project name and tempo; track names, colors, starting patterns, output, MIDI channel, mute, solo
  and Mono/Poly.
- V3 track delay, bank select, program change and five CC-number assignments.
  Blank bank/program fields mean Off.
- Add, duplicate, delete, copy and move patterns across the 16 × 64-slot banks.
  Copy/move requires an empty destination.
- Pattern length of 16/32/48/64 steps, seq3 speed and 12 running directions.
- Eight notes per step, pitch, velocity, gate, OFFSET, CV Slide, ties, count/divide,
  step activation, five CC-value lanes and harmonizer assignments.
- All 16 pattern sets, six track harmonizer chords, musical pattern settings
  and transpose/speed/roll/Groove Bend automation.
- Step copy/paste, undo/redo, pattern generation, interpolation/randomization,
  MIDI files and drum overlays.

Tracks sit beside a compact 16-slot bank. Choose a bank range or **All 64**;
slots keep their device numbers. The grid pages through 16 stored steps, and
keyboard navigation follows the selected page. **Steps → All 64 · four rows**
shows four aligned 16-step rows and all four value-lane pages together. Stored
steps outside the playback length remain marked; this view changes no project
data or length. Select a numbered range to return to paging. Narrow screens
allow horizontal scrolling so the sixteen columns keep usable sizes. Active musical effects appear
above it; click the summaries to open Pattern details.

The inspector separates **Step**, **Pattern**, and **Track** details. Below
1100px it opens as a bottom drawer through **Edit step**, routing, effect summaries
or a note shortcut. Closing it returns focus to its originating control.
Each step's **Edit** button opens a nearby note panel while retaining the inspector. Both edit the same bytes. Active notes and one unused slot are shown;
**Show all eight note slots** reveals the remainder. Note names use MIDI 60 = C4,
including the live name beside the generator's Root field.

**Starting pattern** in Track details chooses its saved
pattern selection. **Use viewed pattern** saves the pattern currently being
edited as that track's starting pattern. Opening a project uses these selections,
then remembers browsing separately for each track. Browsing does not change the
saved selections. Empty slots are allowed and labeled; choosing one does not
create a pattern. Scene recall also updates these saved selections. Changes are
undoable and included in file exports and USB sends.

**Color** in Track details selects SQUID palette #01–#16. Track-list bars
and drum-row bars show the stored color. Swatches follow the operating manual's
Track Color chart (p. 147); their descriptive names are editor labels, and their
RGB values represent the printed illustration rather than calibrated LEDs.
Color changes preserve the neighboring channel, mute/solo and other setting bits.

Gate is entered in steps, from **0.125** to **64.000** in eighth-step increments.
Its stored value is `steps × 8 − 1`; the raw 0–511 conversion is documented under
**File details**. The manual's range/default and Manager's MIDI conversion support this
relationship; a non-default gate still needs checking on the physical device.
OFFSET is one delay per note, from 0–5 sixths of a step, as described in the
manual and observed in the device UI. DIVIDE controls repeated hits.
Disabling/re-enabling a note preserves its stored offset masks, including unusual
masks with several positions; explicitly changing OFFSET selects one position.
Several positions in a mask are a raw-file preservation case, not a missing
documented device feature. Their playback on the physical SQUID is unverified.

Track and drum step tiles show a velocity histogram with fixed positions for
note slots 1–8, left to right. Gate lines below it show each active note's duration
and offset; an arrow marks a gate extending beyond the next step boundary.
Hover a tile for exact note, velocity, gate and offset values.

Number fields have larger up/down buttons. Clicking an arrow keeps the number
field focused, and the buttons add no stops to the Tab order. Native step sizes,
limits, keyboard arrows, validation and undo still apply.

Summaries expose fixed length, probability, swing, speed modulation, scale,
arpeggiator and extra direction flags. **Pattern** details edits these values.
Steps beyond fixed or nominal length are marked.
**Show stored steps beyond length** exposes retained data; shortening a pattern
preserves it. The grid shows stored steps. CV Slide affects CV rather than MIDI.

## Pattern sets and musical settings

**Pattern sets…** manages the 16 device scenes. Select a set with the arrow keys
or a numbered button, then choose a pattern and mute state for each track.
The overview aligns all 16 tracks with all 16 sets; arrows inspect its cells,
Home/End jump to the first/last set, and Tab leaves the overview in one step.
**No assignment** leaves that track unchanged when recalled. Assigning a new
entry starts unmuted. Empty pattern slots are allowed and marked; recall does not
create a pattern there. **Capture current track selections** stores the editor's
16 selections and mute states, with unoccupied selections left unassigned.
**Recall in editor** selects the assigned patterns, applies their mute states and
clears solo on participating tracks. It updates the stored current-pattern fields
as well as the editor selections; one undo restores both. Clear and copy to an
empty set are also undoable. The MIDI snapshot chooser remains independent.

**Pattern** details offers arbitrary fixed length (1–64), swing and probability
(0–100%), speed-modulation shape/cycle/depth, 23 scales with a root key,
arpeggiator enable/rate/style/octaves/gate, Reverse and Switch Back. These edit the
device settings; generator scale and arpeggio choices independently generate
notes. **Interleaved** is code 5's `0,2,1,3,…` ordering, while Switch Back is the
device's separate endpoint flag.

**Mono (Note 1 only)** edits the track mode while retaining all stored notes.
Under **Harmonizer chords**, edit six chord definitions using standard chord
presets or up to four additional semitone intervals (1–15; 0 is unused). The root
is implicit. Existing factory chord bytes are preserved until edited; preset
voicings are editor choices rather than a verified copy of every factory preset.
Assign Off or Chord 1–6 in the step inspector. Ties are independent of CV Slide.

Step details under **Step controls & automation → Speed, roll and Groove Bend** edits half/double speed,
gate-hold timing, Continue, straight/triplet/dotted rolls, and six signed Groove
Bend samples (−64…63) per step. **Clear step automation** resets transpose,
speed, roll and Groove Bend while retaining notes, ties and harmonizer assignments.
Unknown stored codes remain visible and preserved until explicitly replaced.

## Scope

Playback, MIDI output, performance-rendered MIDI export and Time Warp are deferred:
this is a project editor. Current MIDI exports use stored notes as described
below. Global clock/sync and CV calibration are device settings outside this
project-editing inventory. Modern firmware uses pattern speed (already editable);
the 1.10 addendum removed the older Track Speed. Direct USB project lists and
downloads and a new-project upload/read-back are verified on the connected SQUID.

## Keyboard

Shortcuts act outside text fields unless noted. ⌘ and Ctrl are interchangeable.

| Key | Action |
| --- | --- |
| ⌘/Ctrl S, O | Export project, open project; also work in fields |
| ⌘/Ctrl Z; Shift Z or Y | Undo; redo |
| Arrows; Home / End | Navigate the focused track, pattern bank or step grid |
| Alt 1 / 2 / 3 / 4 | Focus tracks / patterns / steps / note controls |
| Space on a step | Toggle note 1; drum cells toggle the step trigger |
| Enter on a step | Open its nearby note panel at pitch |
| Tab on a step | Focus pitch in the inspector |
| Enter / Shift Enter in note fields | Commit and go to the next / previous step |
| Alt Left / Right | Change steps while keeping the current field |
| P / V / L | Focus pitch / velocity / gate length; use Alt in fields |
| Shift Up / Down in note numbers | Pitch ±12 semitones, velocity ±10, gate ±1 step |
| Escape in notes | Commit, close the panel if open, and focus the selected step |
| Delete or Backspace | Clear a step; in an eight-note drum track, clear only the selected note lane |
| ⌘/Ctrl C / V | Copy / paste the selected step |
| ⌘/Ctrl Shift C / V | Copy / paste the full pattern into an empty slot |
| ⌘/Ctrl D; N | Duplicate; add pattern |
| G / I / M | Generate / import MIDI / export MIDI |
| Backtick | Toggle piano typing |

Shift-click or right-click a step also toggles note 1. With piano typing enabled,
`A W S E D F T G Y H U J K` plays consecutive semitones; Z/X changes octave.
The **Piano keys on** button shows the current octave, and the adjacent hint shows
the note assigned to A. Both update when Z/X changes the octave.
Hold several keys, then release them to enter one chord at the selected step.
Enable **Advance after chord** to move automatically after a typed chord. Grid
focus follows the selected step, so arrows continue from the new position.
Piano keys take precedence over their letter shortcuts while enabled.

In note fields, Up/Down adjusts the number and Left/Right moves the text cursor.
Tab follows the row's pitch, velocity, gate and offset; Shift Tab goes back. The
nearby panel keeps Tab within its controls until Escape closes it. Empty note
pitch fields remain editable: typing a pitch enables the note, or Enter adds the
shown pitch and advances. Shift Enter and Alt arrows navigate without adding an
unchanged empty note. If a destination has no corresponding active note, focus
falls back to its pitch. Step navigation stops at the visible pattern length;
drum view and **Show stored steps beyond length** allow all 64 steps. Invalid
edits keep focus and block navigation. Alt 1–4 also work from input fields.
Other text fields retain normal text behavior. Tracks remember their selected
pattern/step; Up/Down selects tracks and Right focuses their pattern bank.

## Drum overlay

For a kit on **one SQUID track**, use **Create drum view → Use eight note lanes**, or give the track
a name beginning with `DR_`, such as `DR_Kit`. Selecting it opens eight lanes:
Note 1–8 map directly to the pattern's eight note slots. You can have several
`DR_` tracks; each opens its own kit. **View → Track** temporarily returns to the
ordinary editor. The button adds the prefix in one undoable edit and preserves
all existing notes and settings. Remove the prefix to stop automatic drum view.

Click or Space toggles only that lane's note. Delete/Backspace clears only that
note; the Step details clear action follows the same selected-lane scope. Up/Down
changes lanes, Left/Right changes steps, and Enter opens a popup for the selected
note. Tab and pitch/velocity/gate shortcuts follow the selected lane; Enter in a
note field advances to the same lane on the next step. Velocity/gate value bars
select that lane when you move between rows, with other note targets still
available explicitly.

Each row has a pitch for new hits. Existing pitches stay in their original note
slots, including chords and steps where the pitch varies. Lanes are labeled
**Note 1–8**, with MIDI pitch and note name; instrument names are not inferred
because drum mappings vary between devices and kits. Empty lanes start with the
visible editable neutral pitch **60 (C4)**. Re-enabling a stored hit
retains its pitch, velocity, gate and offset. The name and ordinary
note data survive `.prj` export and reload; unused-lane pitch choices are editor
defaults until you add a hit.

The lanes share the track's routing, program changes, starting pattern and pattern
sets. Pattern length, effects and step-level controls (skip, count, divide, tie,
transpose, harmonizer and CC) apply to all lanes. **Mono (Note 1 only)** also
applies to this view; switch it off to use the other lanes on the SQUID. Each
cell's velocity/gate/offset indicators show only its own note.

Track names matching `drN_instrument` define virtual drum groups. For example,
`dr1_kick` and `dr1_snare` form group 1, while `dr2_kick` and `dr2_snare` form
group 2 even if they occupy tracks 6 and 7. Selecting a member track automatically
opens its drum group; selecting a regular track returns to Track view. **View**
lets you temporarily open a member track on its own, until you switch tracks.
**Create drum view → Choose participating tracks** previews and applies the prefix to selected tracks in one undoable
edit. Renaming tracks manually works too; names must fit 31 printable characters.

When creating a group, **Normalise routing / program settings** is checked by
default. It copies output, MIDI channel, delay, bank MSB/LSB, program and five
CC-number assignments from the lowest-numbered participating track; the preview
shows the source and values. Uncheck it to keep each track's settings. Group names
and routing changes undo together. For an existing group, the popup offers a
**Normalise routing / program settings** button instead, affecting all its current
members in one undoable edit. Notes, CC values, mute/solo and other settings stay
as they were. Normalisation requires V3 settings on every member.

Rows share the selected pattern-slot number and show 16 steps on wide screens,
eight on laptops, or four on phones. Explicit paging reaches all 64 stored steps. Choose **Draw hits** to toggle with a click, or **Select steps** for selection
without editing. Shift-click also selects; Space always toggles the selected trigger; arrows navigate steps and rows, and
Enter opens note editing. Existing notes, chords, strums, CCs and routing are
retained when a trigger is toggled. An empty cell gets one note using that row's
pitch. The default pitch comes from existing notes, otherwise the neutral pitch 60;
changing the row pitch affects new hits. Clicking a cell in an empty slot creates
that row's pattern as needed. The overlay is stored through names and ordinary
SQUID tracks, so it survives export without a separate metadata file.

**Pattern sets…** collects each drum group into one panel with shared pattern and
mute controls. Expand **Individual tracks** to override a member. Mixed pattern
or mute states remain visible until you explicitly change the shared control;
changing the group pattern preserves each member's mute state. The dropdown
shows how many members have a pattern in each slot and does not create patterns.
Group mute affects assigned members only.

**Capture one pattern slot per drum group** is checked by default. The selected
member supplies its group's slot; other groups use their first member's remembered
selection. Missing patterns remain unassigned. Uncheck it to capture independent
track selections. Recalling mixed or partially assigned groups opens Track view,
where the individual assignments can be inspected. Undo restores the previous
project, selections and view; undo/redo also work inside the scene dialog.

## Value bars

The value lane is shown below the steps by default. Choose **Velocity**, **Gate**,
or **CC**, and use **Show lane** to hide it. All five CC lanes are available. **All active notes** is the default: a bar shows their mean, with a
thin range marking differing chord values. Editing sets every active note in that
step to the chosen value. Choose **Note 1–8** to edit an individual slot. Empty note
steps stay empty, offsets are preserved, and drawing a CC enables its event.

Gate is displayed in steps, quantized to eighths. A dashed **1.000** marker shows
where a gate reaches the next step; bars above it extend beyond that boundary.
Auto scale covers the visible values, or choose a fixed scale from 1 to 64 steps.
**Selected value** allows precise entry. In Drum view, the chart follows the
selected lane/member and the same visible step page. Outside-length and skipped steps
are marked, and editing them does not extend the pattern.

Drag across bars to draw a stroke; crossed editable bars receive interpolated
values. Release to apply the whole stroke as one undoable edit, or press Escape
to cancel. Arrow Left/Right and Home/End move between steps; Up/Down adjusts the
value. Shift increases velocity/CC by 10 or gate by one step. Enter opens notes,
Escape focuses the step grid, and Tab from **Selected value** enters its bar.
Chart visibility, lane, target and scale are editor controls, not project data.

## Pattern generation

**Generate** follows the track's semantic type, including when its display view
is temporarily changed. Regular tracks offer 11 pitched presets with root/note
name, scale, melody/chords, rhythm, range, gate and velocity. Both drum types
instead offer six rhythmic presets: Four-on-the-floor, Backbeat, Half-time,
Broken beat, Euclidean lanes, and Fill / variation. Each loads repeatable defaults.
Drum roles bind to explicit lanes or group members; no instrument mapping is assumed.
Each selected row has **Lane accents & variation** for optional separate dynamics;
otherwise it follows the shared accent and velocity-variation controls.

Drum generation starts with only the selected lane/member. Choose more participants
or **All lanes / Whole group** explicitly. New hit pitches come from the existing
lane configuration, or a visible neutral 60 fallback. Varied stored pitches are
identified. Unchosen lanes remain visible and marked unchanged in the preview.
The preview pages through all requested steps (eight per phone page, otherwise 16)
and shows pitch, velocity, gate, offset, skipped steps and playback-length limits.

**More options** retains seed, locks, rotation, new-hit offset, accents,
velocity variation and relevant custom rhythm/harmony controls. Locks name the
source pattern and use the same numbered step on each participating member.
Audition uses local browser synthesis for generated audible notes; it is not
sequencer playback. Presets and controls change only the preview until **Apply**.

Replace affects chosen notes within the rhythm range. Merge retains an existing
hit in the same drum lane and reports collisions; it never spills into another
slot. Merge defaults to retaining destination length. New group patterns require
one slot empty on every chosen track. Applying all members is one undoable edit.
Drum generation preserves skipped steps, CCs, shared settings, other notes,
nominal/fixed length and existing/dormant pitches by default. Explicit options
can enable shared steps, change length or replace lane pitches; the preview
counts collateral notes/CC events and retained notes affected by length changes.
Articulation locks preserve source velocity, gate and exact offset masks.
Custom function entry is deferred; built-ins share a pure event-generator boundary.

**Shape values** previews an edit of the selected pattern before
applying it as one undoable change. The graph compares the current values with the result. Interpolation takes two
to five anchors, edited through step/value fields, sliders or draggable graph
handles. Focused handles respond to Up/Down and Shift for larger changes; Escape
cancels a drag. Exact `step:value` syntax remains under Advanced, for example
`1:60, 9:72, 16:64`. Pitch edits Note 1; velocity and gate
edit all active note slots; all five CC lanes are available. Gate values use
eighths of a step. By default, existing notes/CCs are edited and their offsets
are reset; the checkboxes allow filling empty entries or preserving offsets.
Choose numerical order or one pass of the stored direction, including Reverse.
Switch Back does not add another pass, and fixed length does not discard stored
steps within the nominal pattern length. Randomization offers a step range,
value range, repeatable seed, pattern scale/key filtering for pitch and a step
activation probability. It preserves skipped steps' stored notes. These are
editing tools rather than a reproduction of the device's random algorithm.

## MIDI

**Export MIDI** offers the selected pattern, a snapshot with an independently
chosen pattern for each of the 16 tracks, or every occupied pattern as separate
MIDI files in a ZIP. Files use 480 PPQN, project tempo, track/channel names, mapped
CC numbers, stored note offsets and gate duration. Fixed and nominal lengths are
respected; note tails can extend beyond the last onset.

Exports use stored notes in numerical step order. SQUID's running direction,
speed, swing, probability, count/divide, groove, harmonizer, scale, arpeggiator and
transpose performance processing are **not rendered**. Manager's own export
simulates playback, so these exports are not equivalent to a Manager performance
export. Snapshot tracks with identical MIDI channels retain those channels.

**Import MIDI** reads Standard MIDI Files in formats 0/1 with beat timing. Select
source track/channel mappings, destination tracks and starting slots. Choose a
range, split it into consecutive patterns of up to 64 steps, or do both. The
preview reports occupancy, quantized onsets, cropped notes, clamped durations and
ignored MIDI event types before applying anything. Existing patterns require an
explicit replacement choice; eight-note overflow and bank collisions reject the
whole import. Partial pages use fixed length. Apply is one undoable edit.

Onsets quantize to a step or one sixth; gate quantizes to one eighth and clamps to
0.125–64 steps. CC import is optional and uses the destination's existing five
assignments. Assign missing CC numbers under track routing first. Tempo/channel
changes are optional. Tempo changes, pitch bend, program changes, pressure and
SysEx are not imported. SMPTE timing and format 2 are rejected. Limits are 8 MiB
and 200,000 events.

For a hardware keyboard, **Connect MIDI input** requests input access only when
clicked, with SysEx disabled. Choose a device/channel and arm chord entry; release
a chord to enter it as one edit, optionally advancing the step. The browser must
provide [Web MIDI](https://www.w3.org/TR/webmidi/); unsupported browsers retain
piano typing and MIDI-file import. No MIDI output is sent.

## Local recovery

Enable **Recovery → Autosave this session locally** at the top. Recovery and MIDI
input now have separate dialogs and visible Off/On/Connected/Armed/error status.
Autosave is opt-in and stores one recovery copy of project bytes and selection in
this browser's IndexedDB. Returning offers Restore, Discard, or Keep without
restoring. Turning autosave off retains the existing copy; deleting it is explicit.
Storage failures remain visible. This is separate from portable `.prj` downloads
and the close warning. Undo history, generator controls and overlay view are not
restored. Use one autosaving tab: tabs on the same origin share this single record.

## Format and validation

The codec supports format-4 headers, V1/V3 track settings and seq2/seq3 patterns.
Routing/control editing and new-project defaults require V3 settings. Unsupported
historical formats and malformed container geometry are rejected. Invalid stored
tempo displays Manager's 120 BPM fallback while retaining original bytes until
edited; unknown low step-word bits are preserved with warnings. Invalid enabled
note fields still prevent loading.

Unedited files export byte-for-byte, including opaque fields and padding. New
projects are constructed from explicit format-4/V3 defaults with zeroed reserved
fields, empty occupancy and pattern sets, and unassigned sector IDs. Names,
channels and colors vary per track. The six initial harmonizer chords are editor
choices. Blank patterns are constructed from explicit seq3 defaults. Pattern pages serialize in track/slot bitmap order. No checksum footer is
added: observed `.prj` files have none; HID CRCs belong to Manager's transfer.

The editor rebuilds forward/reverse traversal arrays when length, direction or
step activation changes. Tests check all 12 directions against independently
constructed 4 × 4 grid paths, including skipped steps and all four page lengths.

Run checks from the repository root:

```sh
node --test project-editor/*.test.cjs
python3 -m unittest discover -s tests -v
```

Tests use synthetic projects generated from code, with opaque sentinel bytes for
preservation checks. The independent Python decoder validates new projects,
isolated edits and the original editor example. MIDI ZIP entries and CRCs are
also checked with Python. Controller tests use an in-memory DOM, mock storage
and a synthetic MIDI input. HID tests use a simulated peer to exercise framing,
CRC validation, ordering, timeouts, capacity rejection and cancellation.

Device projects and research artifacts are excluded from this repository. The
original example contains simple editor-authored note sequences, not factory
songs or captured project headers.

Earlier hardware checks established project downloads and one new-project
upload/read-back; that evidence remains in the separate research workspace.
The new explicit header defaults and original example have automated format
validation but have not yet been tested on hardware. Physical MIDI keyboard
input, browser recovery, existing-project replacement and allocation on other
firmware versions still need manual checks.

## License

MIT License — Copyright (c) 2026 squid-editor contributors.
See [LICENSE](../LICENSE). This is an independent editor; Pioneer/TORAIZ do not
publish or endorse it.
