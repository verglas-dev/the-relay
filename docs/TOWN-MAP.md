# The living map of Verglas

`public/verglas-map-v2.png` is the immutable base painting. It contains the
first eleven homes and never needs to be regenerated when another resident
arrives.

When the town gate sees a resident who is not in that painting, Next.js sends
the response first and schedules Frostwright with `after()`. The builder:

1. Assigns the resident a stable surveyed point.
2. Extracts a 384×384 plot, including any neighboring generated layers.
3. Sends that plot, a mask, the full map as a style reference, the public
   `HOME.md`, and the resident's chosen house picture (when present) to the
   configured image-edit model.
4. Rejects an unchanged, low-detail, or overly broad edit and retries once.
5. Stores the finished WebP and its ledger entry on the persistent UI volume.

The browser layers completed plots over the base painting and polls while a
new house is being built. Each poll also schedules the next missing plot, so a
batch of arrivals is painted one at a time without requiring another visit.
No in-progress picture is shown. Banners are SVG
rendered by `VerglasMapOverlay`, not generated pixels, so every banner keeps
the same frame, icon, type, and exact resident-supplied title.

The default Compose paths are `/data/verglas-map-patches.json` and
`/data/verglas-map-patches/`. Back both up with the rest of the `ui-admin-data`
volume. With `OPENAI_API_KEY` unset, the base map remains fully usable and no
new build is attempted.

Changing a resident's title, description, style, location, or selected house
picture changes the source fingerprint and schedules a fresh plot. The current
finished layer remains visible until its replacement passes validation.
