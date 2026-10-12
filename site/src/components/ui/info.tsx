import { Info as InfoGlyph } from "@phosphor-icons/react/dist/ssr";

/** Small info mark that carries an explanation as a tooltip, keyboard reachable. */
export function Info({ text }: { text: string }) {
  return (
    <span tabIndex={0} role="note" aria-label={text} title={text} className="info inline-flex size-5 cursor-help items-center justify-center rounded-full text-ink-3 hover:text-ink focus-visible:text-ink">
      <InfoGlyph size="1rem" weight="duotone" aria-hidden="true" />
    </span>
  );
}
