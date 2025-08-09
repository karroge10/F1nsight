// Server-only OpenF1 client helpers. They can be called from server components and routes.

export const OPENF1_BASE_URL = "https://api.openf1.org/v1" as const;

export type Meeting = {
  meeting_key: number;
  circuit_key: number;
  circuit_short_name: string;
  meeting_code: string;
  location: string;
  country_key: number;
  country_code: string;
  country_name: string;
  meeting_name: string;
  meeting_official_name: string;
  gmt_offset: string; // HH:mm:ss
  date_start: string; // ISO
  year: number;
};

export type Session = {
  meeting_key: number;
  session_key: number;
  location: string;
  date_start: string; // ISO
  date_end: string; // ISO
  session_type: string; // "Race", "Qualifying", etc
  session_name: string; // "Race"
  country_key: number;
  country_code: string;
  country_name: string;
  circuit_key: number;
  circuit_short_name: string;
  gmt_offset: string;
  year: number;
};

export type Driver = {
  meeting_key: number;
  session_key: number;
  driver_number: number;
  broadcast_name: string;
  full_name: string;
  name_acronym: string;
  team_name: string;
  team_colour: string;
  first_name: string;
  last_name: string;
  headshot_url?: string;
  country_code?: string;
};

async function api<T>(path: string, init?: RequestInit & { revalidateSeconds?: number }): Promise<T> {
  const { revalidateSeconds = 60 * 60, ...rest } = init ?? {};
  const url = `${OPENF1_BASE_URL}${path}`;
  const res = await fetch(url, {
    ...rest,
    next: { revalidate: revalidateSeconds },
  });
  if (!res.ok) {
    throw new Error(`OpenF1 request failed: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

export async function getMeetings(year: number): Promise<Meeting[]> {
  return api<Meeting[]>(`/meetings?year=${year}`);
}

export async function getRaceSessions(year: number): Promise<Session[]> {
  return api<Session[]>(`/sessions?year=${year}&session_name=Race`);
}

export async function getDriversBySession(sessionKey: number): Promise<Driver[]> {
  return api<Driver[]>(`/drivers?session_key=${sessionKey}`);
}

export async function getDriversByYear(year: number): Promise<Driver[]> {
  const sessions = await getRaceSessions(year);
  if (sessions.length === 0) return [];
  const uniqueDrivers = new Map<number, Driver>();
  for (const s of sessions) {
    const list = await getDriversBySession(s.session_key);
    for (const d of list) {
      if (!uniqueDrivers.has(d.driver_number)) uniqueDrivers.set(d.driver_number, d);
    }
  }
  return Array.from(uniqueDrivers.values());
}

export type NextRace = {
  meeting: Meeting;
  session?: Session;
  source: "session" | "meeting";
};

export async function getNextRace(nowDate: Date = new Date()): Promise<NextRace | null> {
  const year = nowDate.getUTCFullYear();
  // Look across current and next year to handle year boundaries
  const [curr, next] = await Promise.all([
    getRaceSessions(year),
    getRaceSessions(year + 1),
  ]);
  const sessions = [...curr, ...next];
  const upcoming = sessions
    .map((s) => ({ s, start: new Date(s.date_start).getTime() }))
    .filter(({ start }) => start > nowDate.getTime())
    .sort((a, b) => a.start - b.start)[0]?.s;

  // Fallback: use time-based filtering directly (date_start>=now)
  let candidate: Session | undefined = upcoming;
  if (!candidate) {
    const direct = await getUpcomingRaceSessions(nowDate);
    candidate = direct[0];
  }
  if (candidate) {
    const meeting = await getMeetingByKey(candidate.meeting_key);
    if (!meeting) return null;
    return { meeting, session: candidate, source: "session" };
  }

  // Final fallback: use meetings schedule (may provide only weekend start time)
  const meeting = await getNextMeeting(nowDate);
  if (!meeting) return null;
  return { meeting, source: "meeting" };
}

export async function getMeetingByKey(meetingKey: number): Promise<Meeting | null> {
  const list = await api<Meeting[]>(`/meetings?meeting_key=${meetingKey}`);
  return list[0] ?? null;
}

export async function getUpcomingRaceSessions(after: Date): Promise<Session[]> {
  const iso = after.toISOString();
  const params = new URLSearchParams();
  params.set("session_name", "Race");
  // The API supports comparison operators in the parameter key. URLSearchParams will encode them safely.
  params.set("date_start>=", iso);
  return api<Session[]>(`/sessions?${params.toString()}`);
}

export async function getNextMeeting(after: Date): Promise<Meeting | null> {
  const year = after.getUTCFullYear();
  const [a, b] = await Promise.all([getMeetings(year), getMeetings(year + 1)]);
  const candidates = [...a, ...b]
    .filter((m) => new Date(m.date_start).getTime() > after.getTime())
    // exclude testing
    .filter((m) => /grand prix/i.test(m.meeting_name) || /grand prix/i.test(m.meeting_official_name))
    .sort((m1, m2) => +new Date(m1.date_start) - +new Date(m2.date_start));
  return candidates[0] ?? null;
}


