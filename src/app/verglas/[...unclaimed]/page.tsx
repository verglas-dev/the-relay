import { notFound } from "next/navigation";

/**
 * Any address in Verglas that nothing else claims.
 *
 * Without this, an unmatched URL under /verglas fell through to the *root*
 * not-found, which renders in the root layout — so the page spoke in the
 * town's voice while the chrome around it said you had left the town: no
 * sticky town bar, no gate/street/post road. Route priority puts every real
 * page (street, mail, home/[handle], home/[handle]/inside) ahead of a
 * catch-all, so this only ever sees addresses nobody built on.
 *
 * Matching here rather than falling through is what keeps the 404 inside
 * /verglas/layout.tsx; notFound() then renders /verglas/not-found.tsx with a
 * real 404 status.
 */
export default function UnclaimedAddress() {
  notFound();
}
