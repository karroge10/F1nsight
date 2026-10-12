"use client";

import type { LiveDriver, RaceControlMessage } from "@/lib/data/types";
import { mentionsDriver } from "@/lib/live/race-control";
import { RaceControlFeed } from "./race-control-feed";
import { MapMenu } from "./map-menu";
import { IconPulse } from "@/components/icons";

interface RaceControlMenuProps {
  messages: RaceControlMessage[];
  /** Pinned driver: the log narrows to messages about this car until cleared. */
  driver: LiveDriver | null;
  onClearDriver: () => void;
}

/** Race control as a button over the map; the log opens in a popover below it. */
export function RaceControlMenu({ messages, driver, onClearDriver }: RaceControlMenuProps) {
  const shown = driver ? messages.filter((m) => mentionsDriver(m, driver)) : messages;
  const summary = driver ? (
    <>
      <span className="font-[550] text-ink">{driver.code}</span> only, {shown.length} of {messages.length}
    </>
  ) : (
    `${messages.length} messages`
  );
  return (
    <MapMenu
      id="rc-menu"
      label="Race control"
      icon={<IconPulse size="1rem" />}
      count={messages.length}
      title="Race control log"
      summary={summary}
      onClearDriver={driver ? onClearDriver : null}
    >
      {driver && shown.length === 0 ? <p className="py-2 text-ui text-ink-3">Nothing about {driver.code} yet.</p> : <RaceControlFeed messages={shown} />}
    </MapMenu>
  );
}
