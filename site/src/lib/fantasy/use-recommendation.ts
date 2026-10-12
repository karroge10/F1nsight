"use client";

// Runs the fantasy engine's `recommend` in its Web Worker (falls back to the main thread when
// workers are unavailable). The fantasy file is sent once; later requests reuse the worker's
// cached market. "pending" is derived: the result carries the key of the state it answers.

import { useEffect, useMemo, useRef, useState } from "react";
import type { EngineRequest, EngineResponse } from "@/lib/fantasy/engine/worker";
import type { FantasyFile, Recommendation, UserState } from "@/lib/fantasy/engine/types";

export interface RecommendationState {
  result: Recommendation | null;
  pending: boolean;
  error: string | null;
  ms: number | null;
}

interface Answer {
  key: string;
  result: Recommendation | null;
  error: string | null;
  ms: number | null;
}

export function useRecommendation(file: FantasyFile | null, state: UserState | null): RecommendationState {
  const [answer, setAnswer] = useState<Answer | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const sentFile = useRef<string | null>(null);
  const latestId = useRef(0);
  const key = useMemo(() => (file && state ? `${file.season}:${file.round}:${file.generatedAt}|${JSON.stringify(state)}` : ""), [file, state]);

  useEffect(() => {
    if (typeof Worker === "undefined") return;
    try {
      const worker = new Worker(new URL("./engine/worker.ts", import.meta.url), { type: "module" });
      workerRef.current = worker;
      return () => {
        worker.terminate();
        workerRef.current = null;
        sentFile.current = null;
      };
    } catch {
      workerRef.current = null;
      return;
    }
  }, []);

  useEffect(() => {
    if (!file || !state || !key) return;
    const id = ++latestId.current;
    const fileKey = `${file.season}:${file.round}:${file.generatedAt}`;
    const includeFile = sentFile.current !== fileKey;
    const request: EngineRequest = { id, type: "recommend", state, options: { topN: 6, planRounds: 3 }, ...(includeFile ? { file } : {}) };
    const deliver = (response: EngineResponse) => {
      if (latestId.current !== id) return;
      if (response.ok) setAnswer({ key, result: response.result as Recommendation, error: null, ms: response.ms });
      else setAnswer({ key, result: null, error: response.error, ms: null });
    };

    // Debounce: a burst of form edits should produce one engine run, not one per keystroke.
    const delay = answer === null ? 0 : 220;
    let cancelled = false;
    let onMessage: ((event: MessageEvent<EngineResponse>) => void) | null = null;
    const worker = workerRef.current;
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      if (worker) {
        sentFile.current = fileKey;
        onMessage = (event: MessageEvent<EngineResponse>) => {
          if (event.data.id !== id) return;
          deliver(event.data);
        };
        worker.addEventListener("message", onMessage);
        worker.postMessage(request);
        return;
      }
      import("@/lib/fantasy/engine/worker").then(({ handleEngineRequest }) => {
        if (cancelled) return;
        deliver(handleEngineRequest({ ...request, file }));
      });
    }, delay);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      if (worker && onMessage) worker.removeEventListener("message", onMessage);
    };
  }, [file, state, key]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    result: answer?.result ?? null,
    pending: Boolean(key) && answer?.key !== key,
    error: answer && answer.key === key ? answer.error : null,
    ms: answer?.ms ?? null,
  };
}
