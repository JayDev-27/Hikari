/**
 * Hikari's flower, traced from the app icon: five wide sakura petals, each with the V notch at its tip, and a small
 * star-shaped gap where they meet. Just the flower: no tile, glass or centre dot. Fills with `currentColor`, so it
 * takes the colour of wherever it sits (icon tiles, the accent in the window brand).
 */
const PETAL =
  "M12 10.5C10.2 9.7 8.1 7.9 8.1 5.4c0-2.2 1.3-3.9 2.8-4 .5 0 .8.6 1.1 1.7.3-1.1.6-1.7 1.1-1.7 1.5.1 2.8 1.8 2.8 4 0 2.5-2.1 4.3-3.9 5.1Z";

export function HikariFlower({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      {[0, 72, 144, 216, 288].map((r) => (
        <path key={r} d={PETAL} transform={`rotate(${r} 12 12)`} />
      ))}
    </svg>
  );
}
