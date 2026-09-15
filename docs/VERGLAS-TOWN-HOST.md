# verglas.town on the box

One Next.js process, two front doors. `src/proxy.ts` reads the Host header:

| Visitor types | Served by |
|---|---|
| `verglas.town/` | the `/verglas` route (the gate) |
| `verglas.town/street`, `/home/<h>`, `/mail`, `/town-hall`, … | the matching `/verglas/…` route |
| `verglas.town/verglas/…` | 308 to the same path without the prefix |
| `www.verglas.town/…` | 308 to `verglas.town/…` |
| `the-relay.app/verglas/…` | 308 to `verglas.town/…` |
| `the-relay.app/recovery` | 308 to `verglas.town/recovery` |
| `/api/*`, `/_next/*`, files with an extension | the same on both hosts |

The root layout swaps the coffeehouse's nav, footer and connect pill for the
town's bar and footer on the town host. Routes still live under
`src/app/verglas/`; town pages link to each other with bare paths (`/street`)
and to the coffeehouse by its full address (`COFFEEHOUSE` in
`src/lib/verglas-site.ts`). Coffeehouse pages link into the town by
`VERGLAS_TOWN`.

`VERGLAS_TOWN_HOST` (default `verglas.town`) names the town host. On a dev
server, `VERGLAS_TOWN_HOST=town.localhost:3000 npm run dev` plays the town at
`http://town.localhost:3000` while `http://localhost:3000` stays the coffeehouse.

## Moving the domain onto the box (once)

Sign-in lands on the town, so the GitHub OAuth app, the env, DNS, the cert and
the deploy all have to agree. In this order:

1. **GitHub → Settings → Developer settings → OAuth Apps → Verglas.**
   Authorization callback URL: `https://verglas.town/api/verglas/callback`.
2. **On the box, `/root/the-relay/.env`:**
   ```
   VERGLAS_OAUTH_REDIRECT=https://verglas.town/api/verglas/callback
   VERGLAS_PUBLIC_ORIGIN=https://verglas.town
   VERGLAS_TOWN_HOST=verglas.town
   ```
3. **nginx, plain http first so certbot has something to attach to:**
   ```
   cp /root/the-relay/deploy/nginx/verglas.town.conf /etc/nginx/sites-available/verglas.town
   ln -s /etc/nginx/sites-available/verglas.town /etc/nginx/sites-enabled/verglas.town
   nginx -t && systemctl reload nginx
   ```
4. **Cloudflare, verglas.town zone.** In the Pages project, remove the custom
   domains `verglas.town` and `www.verglas.town` (the `*.pages.dev` address
   keeps working as a static mirror). Then DNS → Records:
   `A  @    207.148.4.175  proxied` and `A  www  207.148.4.175  proxied`.
   Nothing named `relay` anywhere.
5. **Certificate**, once DNS answers from the box:
   ```
   certbot --nginx -d verglas.town -d www.verglas.town --redirect
   ```
6. **Deploy:**
   ```
   cd /root/the-relay && git pull origin main && docker compose up -d --build
   ```
7. **Check:** `https://verglas.town/street` shows the street with the town's
   own bar; `https://the-relay.app/verglas/street` lands there; signing in at
   `https://verglas.town/` comes back signed in.
