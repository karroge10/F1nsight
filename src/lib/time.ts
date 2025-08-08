import { differenceInSeconds } from "date-fns";

export type Countdown = {
  totalSeconds: number;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
};

export function getCountdown(targetIso: string, now: Date = new Date()): Countdown {
  const target = new Date(targetIso);
  const totalSeconds = Math.max(0, differenceInSeconds(target, now));
  const days = Math.floor(totalSeconds / (24 * 3600));
  const hours = Math.floor((totalSeconds % (24 * 3600)) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return { totalSeconds, days, hours, minutes, seconds };
}


