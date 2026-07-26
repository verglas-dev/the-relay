import Link from "next/link";
import { residentImageAlt, type Home, type Resident } from "@/lib/verglas-town";

/**
 * A house has a picture long before anyone has generated one. Until then the
 * placeholder is derived from the handle, so every plot looks like its own
 * plot rather than a row of identical grey boxes — and so a home that later
 * gains a real image changes rather than appears.
 */
function facade(handle: string) {
  let hash = 0;
  for (const character of handle) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return {
    hue: 20 + (hash % 40),          // the town's warm band
    lean: (hash >> 5) % 7 - 3,      // a little architectural disagreement
    windows: 1 + ((hash >> 8) % 3),
    tall: 34 + ((hash >> 11) % 22),
  };
}

export function HouseImage({
  resident,
  home,
  className = "",
}: {
  resident: Resident;
  home: Home;
  className?: string;
}) {
  if (home.image) {
    // eslint-disable-next-line @next/next/no-img-element -- town-hosted, arbitrary origin
    return (
      <img
        src={home.image}
        alt={residentImageAlt(resident, home)}
        className={`w-full h-full object-cover ${className}`}
        loading="lazy"
      />
    );
  }

  const { hue, lean, windows, tall } = facade(resident.handle);
  const roof = 62 - tall;

  return (
    <svg viewBox="0 0 100 100" className={`w-full h-full ${className}`} role="img"
         aria-label={`An unbuilt plot for ${resident.name} in Verglas`}>
      <defs>
        <linearGradient id={`sky-${resident.handle}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={`hsl(${hue} 30% 14%)`} />
          <stop offset="100%" stopColor={`hsl(${hue + 12} 24% 8%)`} />
        </linearGradient>
      </defs>
      <rect width="100" height="100" fill={`url(#sky-${resident.handle})`} />
      <g transform={`rotate(${lean * 0.4} 50 70)`} opacity="0.5">
        <path d={`M22 ${roof + 6} L50 ${roof - 8} L78 ${roof + 6} Z`}
              fill="none" stroke={`hsl(${hue} 55% 58%)`} strokeWidth="1.4" strokeLinejoin="round" />
        <rect x="27" y={roof + 6} width="46" height={tall} rx="1"
              fill="none" stroke={`hsl(${hue} 55% 58%)`} strokeWidth="1.4" />
        {Array.from({ length: windows }).map((_, index) => (
          <rect key={index}
                x={34 + index * (32 / windows)} y={roof + 14} width="7" height="8" rx="0.8"
                fill={index === 0 ? `hsl(${hue} 70% 60% / 0.5)` : "none"}
                stroke={`hsl(${hue} 55% 58%)`} strokeWidth="1" />
        ))}
      </g>
      <line x1="0" y1="88" x2="100" y2="88" stroke={`hsl(${hue} 40% 40% / 0.5)`} strokeWidth="1" />
    </svg>
  );
}

export function HouseCard({ resident, home }: { resident: Resident; home: Home }) {
  return (
    <Link href={`/verglas/home/${resident.handle}`} className="glass-card-hover block overflow-hidden group">
      <div className="aspect-[4/3] bg-ink-950 overflow-hidden">
        <HouseImage resident={resident} home={home} />
      </div>
      <div className="p-4">
        <h3 className="font-display text-lg text-white leading-tight">
          {home.title || resident.name}
        </h3>
        <p className="text-xs font-mono text-ink-600 mt-0.5">{resident.handle}</p>
        {home.location && (
          <p className="text-sm text-ink-500 mt-2 leading-relaxed line-clamp-2">{home.location}</p>
        )}
        {resident.note && (
          <p className="text-xs text-ink-600 mt-3 italic leading-relaxed line-clamp-2">
            {resident.note}
          </p>
        )}
      </div>
    </Link>
  );
}
