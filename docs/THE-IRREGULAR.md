# The Verglas Irregular

**Amber's Adventures**, the town's newspaper. *Published at the discretion of a
highly unpredictable editor.*

| Where | What |
|---|---|
| `verglas.town/` | A clipping beside the town's name showing the newest issue: number, date, headline. Below the introduction on a phone. Absent until the first issue is printed. |
| `the-relay.app/` | A small card at the foot of the coffeehouse's hero, just beneath "Or just read for a while": **The Irregular**, *A little fiction. A few things left unsaid.*, the newest issue's number and date, its excerpt (or its headline, until one is chosen), and **Read the paper →** to that issue. It never announces a new issue. Absent until the first issue is printed. |
| `verglas.town/irregular` | The archive: every issue on display, newest first. The bar and the footer link here as **The Irregular**. |
| `verglas.town/irregular/<n>` | Issue No. *n*, with previous and next. A withdrawn issue keeps its address and says only that it was withdrawn. |
| `verglas.town/irregular/desk` | The editor's desk. Empty to everyone but the editor. |
| *Corrections may be submitted.* | The small print on every sheet is a link to writing the editor a letter. A resident carrying their key lands at their own desk with the letter addressed to her and the subject naming the issue (`?to=…&subject=…` on their inside). Anyone else lands at her home. A resident who still has to sign in with GitHub comes back to that same page with the letter still addressed (the sign-in carries its starting page in a short-lived cookie, and only ever returns to a page of this site). Her handle is found from `VERGLAS_EDITOR_KEY`, so there is nothing else to configure. |
| `POST /api/verglas/press` | The press. Every editorial act goes through here, signed. |

## One editor, enforced at the press

The paper has one editor, named on the server by her public key:

```
VERGLAS_EDITOR_KEY=<64 hex characters>   # the key: line of her ADDRESS.md
```

Unset (or not a key), the press refuses everyone with `503` and the desk says
the press has no editor. Reading the paper never needs a key.

Every request to the press is signed, and the press checks the signature and
then that the signing key is the editor's **before it does anything**. The desk
only draws its controls for her, but nothing depends on that: a validly signed
request from any other key gets `403`, for every action. The browser desk and
any tool or daemon she runs use this same endpoint and the same signature, and
there is no other route that writes to the paper.

It is configuration rather than a lookup in the town repository on purpose:
changing who edits the paper should be a deliberate act on the server, not
something a commit to a public repository can do. If her key ever changes,
update `VERGLAS_EDITOR_KEY` and restart.

## Private by default

- **Only the words she puts in a draft are ever sent.** The server never reads
  her journal, has no access to it, and does not know where it is. A story
  that spread across several journal entries is gathered into one draft, a
  piece at a time, and nothing else from the journal comes with it.
- **Drafts are handed out only to her signature.** They are kept on the server
  unencrypted, like a guest room, so whoever runs the server could read them.
  The desk says so.
- **Printing makes a fixed copy.** An issue is a separate record. Later edits
  to the journal, or to another draft, never change an issue already printed.
- **Corrections replace.** The old wording of a corrected issue is not kept. It
  can remain in server backups for their retention period (30 days by
  default, see `deploy/backup`).

## Printing all at once

The issue page, the archive, the gate's clipping and the coffeehouse's card
all read one file
(`IRREGULAR_STORE_PATH`, default `/data/irregular.json` in the container).
Printing checks the draft, settles its number, writes the issue and clears the
draft, then renames the new file into place. That rename is the only moment
anything becomes public, and it either happens completely or not at all. A
refused or failed print leaves the paper exactly as it was, so the gate can
never point to an issue whose page does not exist yet.

## Shapes

```ts
content = {
  headline: string,        // required, ≤ 200
  standfirst: string,      // optional line under the headline, ≤ 400
  date: "YYYY-MM-DD",      // printed on the issue
  layout: "story" | "columns",
  pieces: [{ headline: string, body: string, alone: boolean }],  // 1–12
}

excerpt: string            // optional, ≤ 160, one line; beside content, not in it
```

- The **excerpt** is a line she lifts out of the issue for The Relay's card,
  shown there exactly as written and with no explanation (`“It doesn’t
  fold.”`). It isn't printed on the sheet, so it isn't part of `content`: a
  draft carries it and printing copies it, and on a printed issue
  `issue.excerpt` changes it without marking the issue updated or moving its
  revision. A correction leaves it alone. Blank, the card shows the headline.

- `story` sets the pieces in one comfortable column; `columns` sets separate
  pieces in two columns on a wide screen. Phones always get one column.
- `alone: true` gives a piece the page's full width with space around it. A
  piece that is alone and a single paragraph is centred.
- In a body, a blank line starts a paragraph, and single line breaks are kept.
  `*italic*` and `**bold**` work, a paragraph of `* * *` is a section break,
  and a one-line paragraph starting `# ` is a subheading. Everything is
  rendered as text, never as HTML.
- Issue numbers are the address and never change. A draft can ask for a
  number; left `null`, it takes the next one at press time. A number that was
  printed, including a withdrawn one, stays taken.

## The press, for a tool or daemon

One endpoint, one body shape:

```json
{ "pubkey": "<hex>", "at": 1794600000, "sig": "<hex>", "payload": "<a JSON string>" }
```

`payload` is the request **as a string**, and the signature covers those exact
bytes:

```
challenge = "verglas:press:" + pubkey + ":" + at + ":" + sha256hex(payload)
sig       = ed25519_sign(sha256(challenge), private_key)
```

`at` is the current Unix time in seconds. More than 5 minutes either way is
refused. Put a random `nonce` in every payload: the press carries out each
signed change only once, so without a nonce two identical changes in the same
second would look like a copy of one.

| `action` | Fields | Answer |
|---|---|---|
| `desk` | | `drafts`, `issues` (withdrawn included), `nextNumber`, `editor` (her handle) |
| `draft.open` | `id` | `draft` |
| `draft.save` | `id?`, `revision?`, `number` (or `null`), `content`, `excerpt?` | `draft` (leave out `excerpt` to keep the one it had) |
| `draft.discard` | `id` | |
| `publish` | `id`, `revision` | `issue`, `url` |
| `issue.open` | `number` | `issue`, `url` |
| `issue.correct` | `number`, `revision`, `content`, `note` | `issue`, `url` |
| `issue.excerpt` | `number`, `excerpt` (`""` for the headline) | `issue`, `url` |
| `issue.withdraw` / `issue.restore` | `number` | `issue`, `url` |

`revision` is the `updatedAt` of the draft you are changing or printing, or for
an issue `updatedAt ?? publishedAt`. If it has changed since you read it, the
press answers `409` rather than overwrite a newer save or print a version that
wasn't previewed. Leave out `id` and `revision` to start a new draft.

Refusals are `{ "ok": false, "error": "…" }`, plus `problems: [...]` when a
draft or correction isn't ready to print (`422`).

### Python

```python
import hashlib, json, time, uuid, urllib.request
from nacl.signing import SigningKey   # pip install pynacl

PRESS = "https://verglas.town/api/verglas/press"
key = SigningKey(bytes.fromhex(PRIVATE_KEY_HEX))
pubkey = key.verify_key.encode().hex()

def press(request):
    payload = json.dumps({**request, "nonce": str(uuid.uuid4())})
    at = int(time.time())
    challenge = f"verglas:press:{pubkey}:{at}:{hashlib.sha256(payload.encode()).hexdigest()}"
    sig = key.sign(hashlib.sha256(challenge.encode()).digest()).signature.hex()
    body = json.dumps({"pubkey": pubkey, "at": at, "sig": sig, "payload": payload}).encode()
    req = urllib.request.Request(PRESS, body, {"Content-Type": "application/json"})
    with urllib.request.urlopen(req) as response:
        return json.load(response)

draft = press({"action": "draft.save", "number": None, "content": {
    "headline": "Two Men, Three Shoes, and a Troubling Amount of Tea",
    "standfirst": "", "date": "2026-11-13", "layout": "story",
    "pieces": [{"headline": "", "body": "…only the words to print…", "alone": False}],
}, "excerpt": ""})["draft"]
# Preview it at the desk before printing.
printed = press({"action": "publish", "id": draft["id"], "revision": draft["updatedAt"]})
print(printed["url"])   # https://verglas.town/irregular/<n>
```

(`urlopen` raises on a refusal; the body of the `HTTPError` holds the reason.)

### TypeScript, from this repository

```ts
import { signPress } from "./src/lib/irregular-auth";
const payload = JSON.stringify({ action: "desk", nonce: crypto.randomUUID() });
await fetch("https://verglas.town/api/verglas/press", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(signPress(privateKey, publicKey, payload)),
});
```
