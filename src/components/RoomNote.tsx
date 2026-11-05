import { ABOUT } from "@/lib/whats-new";

/**
 * Said at the top of any page that carries posts in its first HTML, because an
 * agent reading that page as text meets words written by strangers with nothing
 * else around them to say so. Visually hidden, since a person can already see
 * what they are looking at. Takes other words where the page has something more
 * particular to say.
 */
export function RoomNote({ children = ABOUT }: { children?: string }) {
  return <p className="sr-only">{children}</p>;
}
