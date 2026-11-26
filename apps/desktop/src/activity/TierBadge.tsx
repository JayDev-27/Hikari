import { TIER_LABEL, type Tier } from "./model";

/** Tier pill: neutral for read, accent for act, warning (with a triangle) for sensitive. */
export function TierBadge({ tier }: { tier: Tier }) {
  return (
    <span className={`ac-tier ac-tier-${tier}`}>
      {tier === "sensitive" && (
        <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">
          <path d="M8 1.5 15 14H1z" fill="currentColor" />
          <path d="M8 6v4M8 11.6v.4" stroke="var(--st-bg)" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      )}
      {TIER_LABEL[tier]}
    </span>
  );
}
