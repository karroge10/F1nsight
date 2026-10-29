"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { parseSessionKey, sessionKey, type SessionTelemetry, type TelemetryIndexEntry } from "@/lib/telemetry";
import { PageIntro } from "@/components/ui/page-intro";
import { Section } from "@/components/ui/section";
import { IconGauge } from "@/components/icons";
import { TelemetryExplorer } from "./telemetry-explorer";

interface TelemetryPageProps {
  /** The session prerendered into the HTML: the newest one exported. */
  initial: SessionTelemetry;
  index: TelemetryIndexEntry[];
  notice?: string | null;
}

interface Choice {
  key: string | null;
  a: string | null;
  b: string | null;
}

const NO_CHOICE: Choice = { key: null, a: null, b: null };

/**
 * The telemetry page body. The HTML carries the newest session; the session and drivers in the
 * URL (`?s=2026-16-Q&a=RUS&b=ANT`) are read in the browser, and any other session is fetched from
 * its build-time file `/api/telemetry/<key>.json`.
 */
export function TelemetryPage({ initial, index, notice }: TelemetryPageProps) {
  return (
    <Suspense fallback={<TelemetryBody initial={initial} index={index} notice={notice} choice={NO_CHOICE} />}>
      <TelemetryBodyFromUrl initial={initial} index={index} notice={notice} />
    </Suspense>
  );
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function TelemetryBodyFromUrl({ initial, index, notice }: TelemetryPageProps) {
  const search = useSearchParams();
  const ref = parseSessionKey(search.get("s"));
  const choice: Choice = { key: ref ? sessionKey(ref) : null, a: search.get("a"), b: search.get("b") };
  return <TelemetryBody initial={initial} index={index} notice={notice} choice={choice} />;
}

function TelemetryBody({ initial, index, notice, choice }: TelemetryPageProps & { choice: Choice }) {
  const [picked, setPicked] = useState<string | null>(null);
  const wantedKey = picked ?? choice.key ?? sessionKey(initial);
  const [loaded, setLoaded] = useState<SessionTelemetry>(initial);
  const [missing, setMissing] = useState<string | null>(null);
  const session = sessionKey(loaded) === wantedKey ? loaded : null;
  const shown = session ?? loaded;

  useEffect(() => {
    if (sessionKey(loaded) === wantedKey) return;
    let cancelled = false;
    fetch(`/api/telemetry/${wantedKey}.json`)
      .then((r) => (r.ok ? (r.json() as Promise<SessionTelemetry>) : null))
      .then((json) => {
        if (cancelled) return;
        if (json) setLoaded(json);
        else setMissing(wantedKey);
      })
      .catch(() => {
        if (!cancelled) setMissing(wantedKey);
      });
    return () => {
      cancelled = true;
    };
  }, [wantedKey, loaded]);

  function chooseSession(key: string) {
    setPicked(key);
    window.history.replaceState(null, "", `/telemetry?s=${key}`);
  }

  const keepDrivers = picked === null;
  const dek = missing === wantedKey ? `Session ${wantedKey} has no exported telemetry. Pick another session.` : "Two drivers' fastest laps of the session laid over each other by distance: speed, throttle, brake and where the time goes. Car data from FastF1, resampled to 320 points per lap.";
  return (
    <>
      <PageIntro
        label={
          <>
            Telemetry <span className="mx-1.5 text-ink-3">/</span> {shown.season} round {shown.round}
          </>
        }
        title={notice && picked === null && choice.key === null ? "Telemetry comparison" : `${shown.eventName}, ${shown.sessionName}`}
        dek={notice && picked === null && choice.key === null ? `${notice} Latest available: ${shown.eventName}, ${shown.sessionName}.` : dek}
      />
      <Section title="Fastest laps" icon={IconGauge} info="Pick a session and two drivers. The track map shows driver A's speed, or which driver is quicker at each point. The chart interpolates values, so it can smooth out short brake taps." flush>
        <div aria-busy={session === null && missing !== wantedKey} className={session === null && missing !== wantedKey ? "opacity-60 transition-opacity" : undefined}>
          <TelemetryExplorer key={sessionKey(shown)} session={shown} index={index} initialA={keepDrivers ? choice.a : null} initialB={keepDrivers ? choice.b : null} onChooseSession={chooseSession} />
        </div>
      </Section>
    </>
  );
}
