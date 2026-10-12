// Typed WebSocket client for the live service (v2/SPEC.md) plus service discovery. The site is
// static, so all of this runs in the browser. The service is looked for at NEXT_PUBLIC_LIVE_HTTP /
// NEXT_PUBLIC_LIVE_WS when set at build time, otherwise at localhost:8765 but only when the page
// itself is served from this machine. On the hosted site with no service configured nothing is
// probed at all, so there are no failed requests in the console.

import type { LiveCommand, LiveMessage, ReplaySession } from "@/lib/data/types";

const CONFIGURED_HTTP = process.env.NEXT_PUBLIC_LIVE_HTTP ?? null;
const CONFIGURED_WS = process.env.NEXT_PUBLIC_LIVE_WS ?? null;
const LOCAL_HTTP = "http://localhost:8765";
const LOCAL_WS = "ws://localhost:8765";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export interface ServiceStatus {
  live: boolean;
  session: Record<string, unknown> | null;
  next: Record<string, unknown> | null;
}

let statusOnce: Promise<ServiceStatus | null> | null = null;

/** The live service's HTTP base, or null when there is none to talk to from this page. */
export function liveServiceHttp(): string | null {
  if (CONFIGURED_HTTP) return CONFIGURED_HTTP;
  return servedLocally() ? LOCAL_HTTP : null;
}

/** The live service's WebSocket base, or null when there is none to talk to from this page. */
export function liveServiceWs(): string | null {
  if (CONFIGURED_WS) return CONFIGURED_WS;
  return servedLocally() ? LOCAL_WS : null;
}

export async function probeService(timeoutMs = 1500): Promise<ServiceStatus | null> {
  const base = liveServiceHttp();
  if (!base) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${base}/status`, { signal: controller.signal, cache: "no-store" });
    if (!response.ok) return null;
    const json = (await response.json()) as ServiceStatus;
    return json;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** One status probe per page load, shared by every component that asks. */
export function probeServiceOnce(): Promise<ServiceStatus | null> {
  if (!statusOnce) statusOnce = probeService(1500);
  return statusOnce;
}

export async function fetchServiceSessions(season: number): Promise<ReplaySession[]> {
  const base = liveServiceHttp();
  if (!base) return [];
  try {
    const response = await fetch(`${base}/sessions?season=${season}`, { cache: "no-store" });
    if (!response.ok) return [];
    const json = (await response.json()) as { sessions?: ReplaySession[] } | ReplaySession[];
    const list = Array.isArray(json) ? json : json.sessions ?? [];
    return list.map((s) => ({ ...s, source: "service" as const }));
  } catch {
    return [];
  }
}

export interface SocketHandlers {
  onMessage: (message: LiveMessage) => void;
  onOpen?: () => void;
  onClose?: (reason: string) => void;
}

export class LiveSocket {
  private socket: WebSocket | null = null;
  private closedByUser = false;

  constructor(
    private readonly url: string,
    private readonly handlers: SocketHandlers,
  ) {}

  connect() {
    this.closedByUser = false;
    const socket = new WebSocket(this.url);
    this.socket = socket;
    socket.onopen = () => this.handlers.onOpen?.();
    socket.onmessage = (event) => {
      const parsed = parseMessage(event.data);
      if (parsed) this.handlers.onMessage(parsed);
    };
    socket.onerror = () => this.handlers.onClose?.("error");
    socket.onclose = (event) => {
      if (!this.closedByUser) this.handlers.onClose?.(event.reason || "closed");
    };
  }

  send(command: LiveCommand) {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      const text = JSON.stringify(command);
      this.socket.send(text);
    }
  }

  close() {
    this.closedByUser = true;
    this.socket?.close();
    this.socket = null;
  }
}

export function liveUrl(base: string): string {
  return `${base}/ws/live`;
}

export function replayUrl(base: string, season: number, round: number, session: string, speed: number): string {
  return `${base}/ws/replay?season=${season}&round=${round}&session=${session}&speed=${speed}`;
}

export function parseMessage(data: unknown): LiveMessage | null {
  if (typeof data !== "string") return null;
  try {
    const json = JSON.parse(data) as { type?: string };
    if (!json || typeof json.type !== "string") return null;
    return json as LiveMessage;
  } catch {
    return null;
  }
}

function servedLocally(): boolean {
  if (typeof window === "undefined") return false;
  return LOCAL_HOSTS.has(window.location.hostname);
}
