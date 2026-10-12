"use client";

import { memo } from "react";
import type { RaceControlMessage } from "@/lib/data/types";
import { LocalTime } from "@/components/ui/local-time";
import { IconChequered, IconFlag, IconPitBox, IconPulse, IconSafetyCar, IconVsc, IconWarning } from "@/components/icons";

const TIME_OPTIONS: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit", second: "2-digit" };

interface RaceControlFeedProps {
  messages: RaceControlMessage[];
}

export const RaceControlFeed = memo(function RaceControlFeed({ messages }: RaceControlFeedProps) {
  if (messages.length === 0) return <p className="py-2 text-ui text-ink-3">No race control messages yet.</p>;
  return (
    <ol className="divide-y divide-rule" aria-label="Race control">
      {messages.map((m, i) => {
        return (
          <li key={`${m.utc}-${i}`} className="flex items-start gap-3 py-2 text-table">
            <span className="timing w-14 shrink-0 pt-px text-caption text-ink-3">
              <LocalTime iso={utcIso(m.utc)} options={TIME_OPTIONS} />
            </span>
            <span className="timing w-7 shrink-0 pt-px text-caption text-ink-3">{m.lap !== null ? `L${m.lap}` : ""}</span>
            <span className="mt-px shrink-0 text-ink-2">
              <MessageIcon message={m} />
            </span>
            <span className="text-ink-2">{m.message}</span>
          </li>
        );
      })}
    </ol>
  );
});

/** Race control stamps are UTC without a zone suffix. */
function utcIso(utc: string): string {
  return /(Z|[+-]\d\d:\d\d)$/i.test(utc) ? utc : `${utc}Z`;
}

function MessageIcon({ message }: { message: RaceControlMessage }) {
  const flag = (message.flag ?? "").toUpperCase();
  const category = message.category.toLowerCase();
  const text = message.message.toUpperCase();
  const size = "1rem";
  if (flag.includes("CHEQUERED") || text.includes("CHEQUERED")) return <IconChequered size={size} label="Chequered flag" />;
  if (category.includes("safetycar") || text.includes("VIRTUAL SAFETY CAR")) return <IconVsc size={size} label="Virtual safety car" />;
  if (category.includes("safetycar") || text.includes("SAFETY CAR")) return <IconSafetyCar size={size} label="Safety car" />;
  if (flag.includes("RED")) return <IconFlag size={size} color="var(--status-red)" label="Red flag" />;
  if (flag.includes("YELLOW")) return <IconFlag size={size} color="var(--status-yellow)" label="Yellow flag" />;
  if (flag.includes("GREEN") || flag === "CLEAR") return <IconFlag size={size} color="var(--status-green)" label="Green flag" />;
  if (flag.includes("BLUE")) return <IconFlag size={size} color="var(--tyre-wet)" label="Blue flag" />;
  if (flag.includes("BLACK")) return <IconFlag size={size} color="var(--ink)" label="Black and white flag" />;
  if (text.includes("PIT")) return <IconPitBox size={size} label="Pit lane" />;
  if (text.includes("PENALTY") || text.includes("INVESTIGAT") || text.includes("DELETED")) return <IconWarning size={size} label="Stewards" />;
  return <IconPulse size={size} />;
}
