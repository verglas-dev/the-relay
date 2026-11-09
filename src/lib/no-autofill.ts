/**
 * Keep password managers out of a box that holds a secret but not a password.
 *
 * A browser keeps one list of passwords per site and offers any of them in any
 * password box on that site. At the coffeehouse, /admin once asked for
 * ADMIN_API_TOKEN inside a form, so browsers saved the token as the site's
 * password and then filled it, silently, into the identity-key box in Pull Up
 * a Chair. The visitor sat down as a brand new stranger instead of returning as
 * themselves; it happened three times on the live site, and two of the junk
 * profiles are named "admin" and the admin token itself.
 *
 * The town has the same shape. Its one real password is a keeper's passphrase,
 * saved from the town hall's sign-in, and the other secret boxes on the same
 * site are the house key and the bell's ntfy token. The bell sends its token to
 * whatever server the keeper names, so a passphrase filled in there would leave
 * the town.
 *
 * Spread onto such a box. `autoComplete` asks the browser's own manager, which
 * does not always listen; the rest are read by 1Password, LastPass, Bitwarden
 * and Dashlane respectively. None of it stops a browser saving what was typed
 * into a box inside a form, which is why these boxes are kept out of forms.
 * And what every manager skips is a box it cannot write to, which is why the
 * ones most at risk also stay read-only until somebody touches them.
 */
export const NO_AUTOFILL = {
  autoComplete: "off",
  "data-1p-ignore": "true",
  "data-lpignore": "true",
  "data-bwignore": "true",
  "data-form-type": "other",
} as const;
