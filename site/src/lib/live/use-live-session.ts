"use client";

// React hook that owns the connection: the live service (live session, or a replay from its
// archive) when reachable, otherwise the fixture mock fed by the race replay files written at
// build time (/api/replay/<season>/<round>.json). Controls work the same for both.

import { useCallback, useEffect, useReducer, useRef } from "react";
import type { LiveCommand, LiveMessage } from "@/lib/data/types";
import { LiveSocket, liveServiceWs, liveUrl, probeServiceOnce, replayUrl } from "./client";
import { MockLiveStream, type ReplayPayload } from "./mock-stream";
import { initialLiveState, liveReducer, type LiveState } from "./reducer";
import { clampToTimeline } from "./seek";

const UNAVAILABLE = "Replays of this session are not available here yet";

export interface ReplayTarget {
  season: number;
  round: number;
  session: string;
}

export interface UseLiveSessionOptions {
  replay: ReplayTarget | null;
  preferLive?: boolean;
}

export interface LiveControls {
  pause: () => void;
  resume: () => void;
  setSpeed: (value: number) => void;
  seek: (t: number) => void;
}

export function useLiveSession({ replay, preferLive = true }: UseLiveSessionOptions): { state: LiveState; controls: LiveControls } {
  const [state, dispatch] = useReducer(liveReducer, undefined, initialLiveState);
  const socketRef = useRef<LiveSocket | null>(null);
  const mockRef = useRef<MockLiveStream | null>(null);
  const speedRef = useRef(1);
  const replayKey = replay ? `${replay.season}:${replay.round}:${replay.session}` : "";

  useEffect(() => {
    let cancelled = false;
    dispatch({ type: "reset" });
    dispatch({ type: "connection", connection: "connecting" });
    const now = () => performance.now();
    const onMessage = (message: LiveMessage) => dispatch({ type: "message", message, receivedAt: now() });

    async function connect() {
      const status = await probeServiceOnce();
      if (cancelled) return;
      const wsBase = liveServiceWs();

      if (preferLive && status?.live && wsBase) {
        const socket = new LiveSocket(liveUrl(wsBase), {
          onMessage,
          onOpen: () => dispatch({ type: "connection", connection: "live", source: "service" }),
          onClose: () => dispatch({ type: "connection", connection: "offline" }),
        });
        socketRef.current = socket;
        socket.connect();
        return;
      }

      if (!replay) {
        dispatch({ type: "connection", connection: "offline", source: status ? "service" : null });
        return;
      }

      if (status && wsBase) {
        const socket = new LiveSocket(replayUrl(wsBase, replay.season, replay.round, replay.session, speedRef.current), {
          onMessage: (message) => {
            onMessage(message);
            if (message.type === "init") dispatch({ type: "connection", connection: "replay", source: "service" });
          },
          onOpen: () => dispatch({ type: "connection", connection: "loading", source: "service" }),
          onClose: () => dispatch({ type: "connection", connection: "offline" }),
        });
        socketRef.current = socket;
        socket.connect();
        return;
      }

      if (replay.session !== "R") {
        dispatch({ type: "error", message: UNAVAILABLE });
        dispatch({ type: "connection", connection: "offline" });
        return;
      }

      try {
        const response = await fetch(`/api/replay/${replay.season}/${replay.round}.json`);
        if (!response.ok) throw new Error(UNAVAILABLE);
        const payload = (await response.json()) as ReplayPayload;
        if (cancelled) return;
        const stream = new MockLiveStream(payload, { speed: speedRef.current, onMessage });
        mockRef.current = stream;
        dispatch({ type: "connection", connection: "replay", source: "mock" });
        stream.start();
      } catch (error) {
        const text = error instanceof Error ? error.message : UNAVAILABLE;
        dispatch({ type: "error", message: text });
        dispatch({ type: "connection", connection: "offline" });
      }
    }

    connect();

    return () => {
      cancelled = true;
      socketRef.current?.close();
      socketRef.current = null;
      mockRef.current?.stop();
      mockRef.current = null;
    };
  }, [replayKey, preferLive]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = useCallback((command: LiveCommand) => {
    socketRef.current?.send(command);
    mockRef.current?.command(command);
  }, []);

  const pause = useCallback(() => {
    send({ cmd: "pause" });
    dispatch({ type: "playback", playback: { paused: true } });
  }, [send]);

  const resume = useCallback(() => {
    send({ cmd: "resume" });
    dispatch({ type: "playback", playback: { paused: false, ended: false } });
  }, [send]);

  const setSpeed = useCallback(
    (value: number) => {
      speedRef.current = value;
      send({ cmd: "speed", value });
      dispatch({ type: "playback", playback: { speed: value } });
    },
    [send],
  );

  const timeline = state.timeline;
  const seek = useCallback(
    (t: number) => {
      const target = clampToTimeline(t, timeline);
      send({ cmd: "seek", t: target });
      dispatch({ type: "playback", playback: { t: target } });
    },
    [send, timeline],
  );

  return { state, controls: { pause, resume, setSpeed, seek } };
}
