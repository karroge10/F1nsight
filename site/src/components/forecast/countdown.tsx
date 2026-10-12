"use client";

import { useEffect, useState } from "react";

interface CountdownProps {
  target: string;
  label: string;
}

export function Countdown({ target, label }: CountdownProps) {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = window.requestAnimationFrame(tick);
    const id = window.setInterval(tick, 1000);
    return () => {
      window.cancelAnimationFrame(first);
      window.clearInterval(id);
    };
  }, []);

  const targetMs = new Date(target).getTime();
  const remaining = now === null ? null : Math.max(0, targetMs - now);
  const parts = remaining === null ? null : splitDuration(remaining);

  return (
    <div className="flex flex-col gap-1">
      <p className="label">{label}</p>
      <p className="headline timing min-w-[11ch] text-[2.75rem] leading-none text-ink sm:text-[3.5rem]" aria-live="off" suppressHydrationWarning>
        {parts === null ? "--:--:--" : parts.days > 0 ? `${parts.days}d ${parts.hh}:${parts.mm}:${parts.ss}` : `${parts.hh}:${parts.mm}:${parts.ss}`}
      </p>
    </div>
  );
}

function splitDuration(ms: number) {
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return {
    days,
    hh: String(hours).padStart(2, "0"),
    mm: String(minutes).padStart(2, "0"),
    ss: String(seconds).padStart(2, "0"),
  };
}
