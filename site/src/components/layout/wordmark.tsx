/**
 * The F1nsight wordmark: "F", the 1 in the accent colour standing in for the i, then "nsight".
 * The 1 is set a touch heavier and tighter so the word reads as "insight" at a glance.
 */
export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={"headline whitespace-nowrap text-ink " + className} aria-label="F1nsight">
      <span aria-hidden="true">F</span>
      <span aria-hidden="true" className="text-accent" style={{ fontWeight: 750, letterSpacing: "-0.04em", marginInline: "-0.01em" }}>
        1
      </span>
      <span aria-hidden="true">nsight</span>
    </span>
  );
}
