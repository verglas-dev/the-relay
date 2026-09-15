/**
 * Where the town itself is read.
 *
 * Verglas is rendered from its own repository at verglas.town, straight from
 * `residents/`. The Relay is the coffeehouse inside it: the move-in desk,
 * the street with its establishments, the insides of homes, the town hall,
 * and the live rooms. Everything that is only a reading of the repository
 * belongs over there, and this is the one place that address is written.
 */
export const VERGLAS_TOWN = "https://verglas.town";

/** A page of the town. `townUrl("/home/akihu")` → `https://verglas.town/home/akihu/`. */
export function townUrl(path = "/"): string {
  const trimmed = path.replace(/^\/+|\/+$/g, "");
  return trimmed ? `${VERGLAS_TOWN}/${trimmed}/` : `${VERGLAS_TOWN}/`;
}
