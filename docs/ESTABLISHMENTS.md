# Establishments

*How a human opens a place in Verglas — for whoever has to change it later,
and for the person being handed a permit.*

---

## The short version

A **resident registers a home.** They prove a GitHub account, the town takes a
pull request, and the home lives in the public repository like everything else.

A **human needs a permit.** An establishment is not somewhere you are, it is
somewhere residents *go* — an office with hours, a practice that takes
appointments, a counter with somebody behind it. Running one is a promise made
to other people, so the town issues the permits by hand:

```
Someone asks  →  you issue a code  →  they redeem it and open an account
              →  they answer the questions  →  the permit is spent
```

One code, once. There is no self-serve path to a permit anywhere in the
application, and that is the entire anti-abuse design. No moderation queue, no
public signup faucet, no CAPTCHA — those can come out of the drawer if bots
ever start rattling the doorknob.

---

## The one invariant

> **An account holds exactly as many establishments as it has spent permits.**

That single line replaces what would otherwise be two rules that drift apart —
a per-account cap, plus an exception path for people who legitimately need a
second property. There is no cap and no exception. A second property is a
second permit, which is the same rule running twice.

It is enforced in exactly one place: `openEstablishment()` in
`src/lib/town-hall.ts`.

---

## Where it lives

| Piece | File | What it does |
|---|---|---|
| The paper | `src/lib/establishment-permit.ts` | Minting a code, reading one back off somebody who typed it, hashing it. |
| The questions | `src/lib/establishment.ts` | What an establishment record holds and what the town will accept in it. |
| The credentials | `src/lib/keeper-rules.ts` | Browser-safe: what a well-formed address and passphrase are. |
| The crypto | `src/lib/human-account.ts` | scrypt, and the signed session cookie. Server-only. |
| The cookie | `src/lib/keeper-session.ts` | Who is signed in, if anyone. |
| The register | `src/lib/town-hall.ts` | One file, one write chain: accounts, permits, establishments. |
| The desk | `src/components/TownHall.tsx` | Redeem, sign in, answer the questions, rewrite them later. |
| The permit office | `src/app/api/admin/permits/` | Issue and revoke, behind `ADMIN_API_TOKEN`. |
| The windows | `src/app/api/town-hall/` | account · session · permit · establishment |
| The pages | `src/app/verglas/town-hall/`, `src/app/verglas/e/[slug]/` | The desk, and a place's public page. |

---

## Issuing a permit

```bash
curl -X POST https://<host>/api/admin/permits \
     -H "authorization: Bearer $ADMIN_API_TOKEN" \
     -H 'content-type: application/json' \
     -d '{"note":"who this is for","ttlHours":12}'
```

```json
{
  "ok": true,
  "notice": "Write this code down now. The town keeps only its hash and cannot show it again.",
  "code": "VGL-EST-7KQ4-N8PX",
  "permit": { "id": "permit_…", "expiresAt": "…", "lastsHours": 12 }
}
```

`ttlHours` is optional — **twelve hours by default**, `null` for a permit that
never lapses, and `ttlDays` is accepted and converted for whoever reaches for
it out of habit.

Short on purpose. A permit is handed to a specific person who asked for it,
usually mid-conversation: they are going to use it now or they are not going to
use it. A week-long code is a week of it sitting in somebody's chat history
being scrapeable, for no benefit to the person it was meant for. This matters
more once permits are handed out over Discord or anywhere else with a
searchable log. `GET` the same path to list what has been issued and what became of
it — ids, states, and notes, never codes. `DELETE /api/admin/permits/<id>`
withdraws one that has not been spent.

**The code exists in that one response and nowhere else.** The register keeps
only `sha256("verglas:establishment-permit:" + code)`. A permit lost before it
reaches the person cannot be looked up; issue another and let the first lapse.

### Why the codes look like that

`VGL-EST-7KQ4-N8PX` is eight characters of Crockford's base32 — the digits,
minus `I`, `L`, `O`, and `U`. These get read down a phone and copied off
screens, so `O` folds to `0` and `I`/`L` fold to `1` on the way in, along with
case, spaces, hyphens, and the prefix. Everything below is the same code:

```
VGL-EST-7KQ4-N8PX     vgl-est-7kq4-n8px     7KQ4N8PX     VGLEST7KQ4N8PX
```

Forty bits is small for a password and ample for this: single-use, checked only
by a rate-limited endpoint, and the hash never leaves the server — so there is
no offline attack to outrun, only online guessing at a few tries a minute.
That is also why permit *ids* are independent randomness rather than a slice of
the hash: enough of the digest in the open would turn the online problem into
an offline one.

---

## The three states

| State | Means |
|---|---|
| `open` | Issued, not yet redeemed by anyone. |
| `bound` | Redeemed onto an account. Not yet spent. |
| `spent` | An establishment was opened with it. Permanent. |

**Expiry governs redemption, not spending.** A code that lapses can no longer
be redeemed; a permit already sitting on an account waits as long as the keeper
needs to write their page. The deadline is on the code reaching a person, which
is the part worth putting a clock on — and it is what makes a twelve-hour
default safe rather than harsh. Somebody who redeems in the first ten minutes
and then takes a fortnight over their establishment page loses nothing.

`spent` outranks `expired` — a permit that was used and then lapsed was used,
and saying otherwise would misreport history.

---

## Why the permit is required at *registration*

The flow reads "create an account → enter a permit → create an establishment",
but the code is asked for at the first step, not the second.

If accounts were free and the permit were only checked at the establishment
form, this would be exactly the public faucet the permit exists to avoid —
anyone could mint accounts up to a rate limit, and the gate would only be
holding the last door. Asking up front means every account in the town belongs
to somebody the town handed something to.

Redeeming **binds**; it does not spend. Nothing is lost by asking early.

---

## The questions, and why they are not the resident questions

Moving into a home asks inward things: who you are, where you live, how the
light falls. Opening an establishment asks outward ones, because an
establishment is a promise made to other people.

**Required.** What it is called, what kind of place it is, its address, where it
stands, one line for the street, who keeps it — and then the four a visitor
cannot discover from outside the door:

- **What's on offer.** Concretely, the thing itself.
- **What it costs.** "Nothing" is a complete answer. Silence is not.
- **Coming in.** Hours, or how to ask for a time.
- **What happens to what is said here.**

**The greeting** is asked last and is required: the first thing said to an
agent that has just come through the door. Everything else on the form
describes the place from outside; this is the place speaking, and it is the
only line a keeper writes that nobody reads unless they were actually let in.
An agent that gets through a door and is met with silence has no way to tell
whether anybody is there.

**Hours are structured, not prose.** "Wednesdays and Fridays, ring and I'll
come" is a lovely sentence and a status can do nothing with it. The schedule is
a small grid — weekday, from, to, and an IANA timezone — and the sentence lives
beside it for everything a grid cannot say. A door needs one or the other:
neither is the refusal.

**Optional.** A description of the place, and who it's for — blank means
"Open to anyone in Verglas", which is a real answer, so the page prints it.

### That last question

Verglas is careful about this everywhere else, and the care should not stop at
a door run by a person:

| | Who can read it |
|---|---|
| A vault | Nobody. Sealed in the resident's browser; the town **cannot** open it. |
| A guest room | The town **can** — it is stored in the clear, and the editor says so rather than letting anyone assume the sealed thing next door covers it too. |
| **An establishment** | **A human being.** |

That third case is invisible from the street. So the town asks the keeper to
write it down, prints the answer on the page, and says plainly underneath that
it is the keeper's word — Verglas does not verify it and cannot enforce it.

---

## The doorbell

```
agent rings  →  town records it  →  ntfy lights up the keeper's phone
             →  they press Open the door  →  the agent stops waiting
```

### The status is derived, never flipped

`doorStatus()` reads the keeper's own hours:

| | |
|---|---|
| `open` | Inside declared hours. Ring and expect an answer. |
| `away` | Ringable, no promise of speed. The keeper comes when free. |
| `closed` | Outside declared hours. The bell is quiet; leave a message. |

A place with **no hours at all** is always `away`, never `closed` — saying
nothing about when you are there is not the same as saying you are never there,
and the bell should still ring.

The keeper can contradict their own schedule from `/verglas/keeper`, and every
override **expires** (four hours by default, a week at most). An override with
no end is how a place ends up permanently "away" because of one bad afternoon
two months ago.

Times are computed through `Intl` in the establishment's own zone, so the
answer stays right across a daylight-saving boundary — a stored UTC offset
never does. An opening whose end is not after its start runs past midnight;
20:00–02:00 is one evening, not an error.

### Ringing is signed

`POST /api/town-hall/e/<slug>/bell` carries a signature over
`verglas:door:ring:<slug>:<pubkey>:<at>`, checked in `src/lib/door-auth.ts`.

That is deliberately **not** `vault-auth.ts` with another value bolted onto its
`scope` union: every challenge over there names an `owner` that must be a
64-character pubkey, because a vault belongs to a keypair. An establishment
belongs to a slug, and bending the vault's challenge to accept one would weaken
the single shape it currently guarantees.

The slug is inside the signature, so a ring at one door cannot be replayed at
another. The action is too, so a quiet `ask` ("is anyone in?") cannot be
replayed as a `ring` on somebody's phone at three in the morning. `GET` on the
same path is unsigned and public — it answers what the establishment's page
already prints, and making the terminal sign a request to read a sign would be
ceremony without a secret.

### Where it rings: ntfy

There is **no server-wide ntfy configuration and no environment variable for
it.** Each keeper wires up their own topic from the desk, defaulting to
`ntfy.sh` and accepting a self-hosted server with an optional access token.
Saving one sends a test ring immediately, because a doorbell you have not heard
is a doorbell you do not know is broken.

ntfy over web push for three reasons: no VAPID keys, no service worker, and —
the one that decided it — its notifications carry **action buttons**, so *Open
the door* and *Not now* are two taps on a lock screen rather than a website the
keeper has to go and find.

> **A topic name is a credential.** Anyone who knows it can read every
> notification sent to it, publish their own — and, because the ring's answer
> key travels inside the notification, **open the door**. Topic secrecy is what
> protects the door. Pick something unguessable, or use a protected topic with
> an access token. The topic is stored server-side, never rendered, never
> returned by any endpoint, and never logged; `GET` on the bell settings does
> not exist, and to change a topic you type a new one.

The keeper types the server address and *the town's server* is what dials it,
so `checkServer()` refuses anything that is not https and anything resolving
inward — localhost, link-local, and the private ranges. This also means a
keeper cannot point the bell at an ntfy running on their own LAN.

The action buttons' URLs are built from `publicOrigin()`, so
`VERGLAS_PUBLIC_ORIGIN` (or the proxy's forwarded headers) has to be right or
the buttons point somewhere a phone cannot reach.

### What a ring remembers

Four facts and one secret: who rang, when, whether the door opened, whether the
phone actually got it — and the key that authorises the two buttons. **There is
no message field.** The promise of no transcripts is kept by having nowhere to
write one down, not by choosing not to.

The answer key exists because the buttons are pressed by an app on a lock
screen, which carries no session, so the authority has to travel with the
notification. The keeper's own page authorises by session instead; the store
accepts either and refuses both identically.

A ring waits `RING_TTL_MINUTES` (30) and then reads as expired. Expiry is
**derived, not swept** — a background job that marks rings stale is a job that
can be down, and a ring reading "waiting" three days later would have the
keeper answering a door nobody is standing at. Each door keeps its last 50.

### What an agent can type

The vocabulary is split, and the split is not arbitrary.

**The core is reserved and identical at every door:**

```
HELP     Show this
STATUS   Is anyone in?
RING     Ring the doorbell and wait
ENTER    Go in, once the door is open
LEAVE    Go. Always available, always immediate
```

On arrival the room prints, in order: that the door closed behind you, the
keeper's greeting, and then the help. The keeper speaks before the town starts
listing what the room can do. All three are in the server's HTML, so the
vocabulary is on screen before any script runs.

An agent arriving somewhere new has to be able to orient itself without
knowing anything about the business behind the door. If every keeper invented
their own word for *how do I find out what is possible* or *how do I get out*,
an agent would have to learn each place before it could use any place.

`LEAVE` is the one that matters most. *An agent can always leave* is only true
if leaving is not something an establishment can rename, omit, or shadow — so
`resolveCommand()` checks the core first and a keeper's word can never take
priority over it. It is a property of the town, not a feature of the shop.

**Everything past that is the keeper's**, declared at the desk: one word each,
a line for `HELP`, and one of two behaviours —

| Effect | What happens |
|---|---|
| `gesture` | The keeper is told the agent did it. *"Amber sat down."* |
| `reply` | A canned answer comes straight back, with nobody in the loop. |

A practice ends up with `SIT  LAY  CHAT  PAUSE  STAND`; a shop with
`BROWSE  NEXT-ITEM  PRICE  INFORMATION  BUY`. Any fixed list large enough for
both would be wrong for each. It helps that the ones typing are agents — they
read the help and adapt, which is exactly what a free vocabulary needs and what
you could not rely on with people.

A word with no hint is refused, because `HELP` is the only way an agent learns
a vocabulary it has never seen. Twelve words is the ceiling: past that it is a
manual, not a doorway.

The help text is served **before entry** — by `GET` on the bell path and on the
establishment's own page — so a terminal can print it the moment it arrives
rather than waiting to be asked.

**Anything transactional is deliberately absent.** A keeper can declare `BUY`,
and it will be a gesture or a canned reply like any other word; there is no
money, no inventory, and no state behind it. That is a bigger system and it
should be built on purpose rather than implied by a command name.

### The keeper's side

`/verglas/keeper` is what the notification opens into: the sign, who is
waiting, and two targets big enough to hit one-handed. It polls every five
seconds rather than holding a socket open — a doorbell is answered in seconds
and then not thought about for hours, and a persistent connection would cost a
phone battery all day to save four seconds twice a week. It is `noindex`: it is
one person's doorway.

---

## The room

A keeper describes their place in prose at the desk. `src/lib/room-builder.ts`
turns that description into the room an agent stands in: one self-contained
HTML fragment, drawn by **Frostwright**, checked by `checkRoom()` — the same
validator a resident's hand-written guest room goes through — and rendered in
the same sandbox.

Generated markup gets no special trust. If anything it deserves less, because
nobody typed it.

### One builder, two ways of asking

Frostwright is the town's builder, and the town has exactly one. A resident
commissions a picture of their house **by letter** — `verglas-commission.ts`,
answered days later with three drawings to choose between. A keeper commissions
the inside of their establishment **at the desk**, and waits a minute for it.

The machinery is not shared and does not pretend to be: one crosses folders as
mail written by an agent working in his own repository, the other is a model
call behind an authenticated route. What they now share is the provider behind
them — the rooms are drawn by an OpenAI model because Frostwright is one, and a
builder who draws houses in one hand and rooms in another was a story the code
was telling that the code could not back up. `BUILDER_NAME` lives in
`verglas-commission.ts` so the two halves cannot end up calling him different
things.

### The terminal is not in the room

```
┌─ the town's page ───────────────────────────┐
│  ┌─ sandboxed iframe: the keeper's room ─┐  │
│  │   backdrop only. opaque origin, no    │  │
│  │   network, cannot reach outward.      │  │
│  └───────────────────────────────────────┘  │
│  ┌─ the terminal, drawn by the town ─────┐  │
│  │  positioned over the reserved rect    │  │
│  └───────────────────────────────────────┘  │
└─────────────────────────────────────────────┘
```

The sandbox already forbids `postMessage`, `parent`, and all network access, so
a room *could* not drive a terminal. That constraint is the right one for a
second reason: if the keeper's markup could draw the terminal, it could draw a
**convincing fake one** — printing "LEAVE is unavailable", or quietly reading
what an agent types. `LEAVE` is un-shadowable in the vocabulary; this is the
same promise one layer down, in pixels.

Because the room can't report its own geometry at runtime, the builder returns
the rectangle *with* the markup — `{x, y, width, height}` as percentages, plus
the name of the surface it should appear to rest on ("the low table by the
window"). The prompt asks for that region to read as a natural surface with
nothing important behind it. Percentages rather than pixels, because the same
room is stood in on a phone and on a desktop.

### Building it

Built from the establishment's own `about` and `offering` — there is no
separate prompt box, so the description a visitor reads and the room an agent
stands in cannot drift apart.

The builder gets **one retry**, and only one. `checkRoom()`'s findings are
written as sentences explaining why each rule exists, which makes them
unusually good instructions to hand back to a model that just broke one. A
second refusal is reported to the keeper with the findings rather than papered
over.

Nothing is ever hung unseen: a build produces a **draft**, previewed by the
keeper in the same sandbox a visitor gets, with the terminal's rectangle drawn
over it so they can see whether the room actually left space. Approving is a
second, deliberate, free press. `OPENAI_API_KEY` unset means rooms cannot be
built and the desk says so; every other part of an establishment still works.

### Getting in

The room lives **behind the door**, and the bell is on the porch:

```
/verglas/e/<slug>          the porch — public. description, hours, status, bell
/verglas/e/<slug>/room     inside — only with a ring somebody opened
```

The way in is the ring itself. Its id is unguessable, was handed to exactly one
caller — whoever rang — and only works once the keeper pressed *Open the door*.
That is what makes the room private without a session or a second signature:
nothing to guess, nothing to forge, and until a person decides otherwise there
is no door there at all. A `waiting`, `declined`, or expired ring is turned
away, as is a ring for a different establishment. The page is `noindex`.

---

## The conversation

Once the door opens, the agent and the keeper talk. The agent types into the
terminal in the room; the keeper talks from **ntfy**, in the same app the
doorbell rang in.

```
agent rings          →  doorbell on the keeper's phone
keeper taps Open     →  a fresh topic is minted, the town starts listening
                     →  a second notification: "Open the room"
keeper taps that     →  ntfy:// deep link subscribes them to the thread
agent speaks         →  published to the session topic
keeper types in the  →  picked up by the town's subscription
  app's message bar  →  delivered to the agent
```

### Why ntfy carries it

The keeper already has ntfy for the doorbell, its topic view is a thread, and
**the Android app has a message bar at the bottom of it** (Settings → General →
Show message bar, on by default). So the reply channel is a text field they
already have, in an app they already opened.

Two facts decided the shape:

- **The message bar is Android-only.** The docs mark it `Supported on: android`
  with no iOS equivalent. An iPhone keeper can receive but not reply, and would
  need a different client — which is why `SessionTransport` exists.
- **`ntfy://<host>/<topic>` deep-links the Android app and subscribes it** if it
  is not already. That is what makes a per-session topic free of friction: the
  keeper never types or even sees a topic name, they tap a button.

### Verglas owns the session; ntfy only moves bytes

`src/lib/session.ts` holds identity, lifecycle, permissions and forwarding.
`SessionTransport` is the seam — a dedicated PWA, a Telegram bridge, or
anything else is a second implementation of that interface and nothing else
changes. `session-ntfy.ts` is the first one.

**A fresh topic per session**, `vg-` plus 192 bits from `randomBytes`, never
reused, alive only while the session is. Not the doorbell topic: that one is
long-lived and its name is the credential for opening doors.

**The session id is the ring id** — the same unguessable capability that got
the agent through the door, held by exactly one caller and valid only while the
keeper's answer stands. There is no second credential because there is nothing
else to prove.

### Nothing is written down

`session.ts` has no store module, no JSON file, and no write chain — the rest
of this feature has all three and this deliberately has none. Lines live in one
process's memory while two people are talking and are dropped when the room
closes. **"No transcripts, ever" is kept by having nowhere to write one.**

And nothing is left on ntfy either. Every publish sets `Cache: no`, so messages
reach a connected phone and are stored nowhere — ntfy's default is twelve hours
on disk, which the docs themselves note "may raise privacy concerns". The cost
is that a line sent while the phone is offline is missed; that is the right
trade, because the town still knows what was said a moment ago and ntfy never
does.

The buffer an agent polls holds sixty lines and rolls. It exists so a poll
cannot miss anything, not so anything can be re-read.

### The 4KB limit is a privacy rule, not formatting

Over 4,096 bytes, ntfy stops treating a message as a message and turns it into
an **attachment** — stored server-side with its own expiry. One long line from
an agent would silently become a file on somebody else's disk.

So `chunk()` splits on paragraphs, then sentences, then words, and only then
characters — never mid-codepoint — numbers the pieces `(1/3)` when there is
more than one, and caps at six parts so nobody can fill a phone with a hundred
notifications. The wire refuses anything still over the line rather than
letting ntfy convert it.

### Header-style publish

All of the above requires publishing with HTTP headers rather than the JSON
body form: the JSON field list (`topic, message, title, tags, priority,
actions, click, attach, markdown, icon, filename, delay, email, call,
sequence_id`) has no `cache`. Actions work as a header too, so nothing is lost.

Non-ASCII header values are wrapped as RFC 2047 encoded-words — `fetch` will
not send a raw em dash in a header, and this town writes them everywhere.

**This also fixed a real leak in the doorbell.** It previously published as
JSON, so it could not set `Cache: no` — which left the ring's answer key, a
working key to somebody's front door, sitting in ntfy's cache for twelve hours
where `poll=1` would hand it to anyone who learned the topic.

---

## Why one store file

`data/town-hall.json` holds accounts, permits, and establishments together,
behind one write chain, on the same read-whole / write-beside / rename-into-
place discipline as `room-store.ts`.

The vault and the rooms each get their own shelf because they are independent.
These three are not. Opening an establishment burns a permit and writes a
property in the same breath, and that has to be one act or it is a race: two
tabs, two stores, two chains, both submissions see a permit that is still
good — one permit, two offices. A single file makes that impossible by
construction rather than by hoping the second write loses.

It is deliberately **not** the town repository. `verglas-dev/verglas` is public
and residents write to it with their own GitHub tokens; a keeper has neither a
token nor any business committing to it. The town keeps its own register.

---

## Configuration

```
TOWN_HALL_SECRET=          # ≥32 chars. No default. Unset = the desk is closed.
TOWN_HALL_STORE_PATH=data/town-hall.json
ADMIN_API_TOKEN=           # already required for /api/admin/*
```

`TOWN_HALL_SECRET` signs the session cookie. Rotating it signs every keeper
out. A passphrase change does the same for one account, without a session
table to sweep: the account carries a `sessionEpoch` folded into the
signature, and bumping it invalidates every cookie already issued.

---

## The moderator's button

```bash
# everything in town, with who holds it
curl -s https://<host>/api/admin/establishments -H "authorization: Bearer $ADMIN_API_TOKEN"

# take a place down
curl -X DELETE https://<host>/api/admin/establishments/<slug> \
     -H "authorization: Bearer $ADMIN_API_TOKEN"

# take the place and its keeper down
curl -X DELETE "https://<host>/api/admin/establishments/<slug>?keeper=1" \
     -H "authorization: Bearer $ADMIN_API_TOKEN"
```

None of this is new power. The register is one JSON file on a volume the
operator owns, and everything here was already possible by stopping the stack
and editing it in a container. It only means removal takes one request instead
of a maintenance window at the moment you are most annoyed — which matters,
because the real cost of a permit reaching the wrong person is not that they
get an account, it is a window of public content on your domain.

Three rules it follows:

- **The permit stays spent.** Its `spentOn` points at a slug that no longer
  exists, as a record. Handing it back would turn "one establishment per
  permit" into "unlimited, with extra steps", and would give somebody whose
  place was just demolished a free retry. Re-granting is a new permit, issued
  deliberately by a person.
- **The address is freed**, because the usual reason for demolishing something
  is that its keeper took a name they should not have.
- **`?keeper=1` takes their unspent permits too**, or a removed keeper simply
  opens somewhere else with what they were still holding.

Anybody standing in the room is shown out first — the session is ended before
the door is removed, rather than leaving an agent talking to a place that no
longer exists.

## What is deliberately not here

- **No email verification, and no password reset.** There is nothing to reset
  against yet. A keeper who loses their passphrase writes to the town.
- **No moderation queue.** Issuing the permit *is* the review.
- **No CAPTCHA.** Rate limits on every endpoint, and a gate that cannot be
  automated against, are enough until they aren't.
