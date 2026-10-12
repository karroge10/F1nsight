import type { LiveDriver, RaceControlMessage } from "@/lib/data/types";

/** True when a race control message is about this car: by driver field, "CAR 81" or "(PIA)". */
export function mentionsDriver(message: RaceControlMessage, driver: LiveDriver): boolean {
  if (message.driver !== null && Number(message.driver) === driver.number) return true;
  const text = message.message.toUpperCase();
  const carPattern = new RegExp("\\bCARS? " + driver.number + "\\b");
  if (carPattern.test(text)) return true;
  return text.includes(`(${driver.code.toUpperCase()})`);
}
