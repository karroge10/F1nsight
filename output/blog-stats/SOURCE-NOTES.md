# F1nsight data coverage source notes

Captured from local audit artifacts on 2026-10-23. `coverage.json` contains exact totals and per-season counts for three separate datasets: the cloud state audit archive, the telemetry repair staging snapshot, and the local checkout.

The cloud state audit archive has 322 telemetry session exports and no 2026 round 17 session exports. The repair staging snapshot has 326 session exports, including four Singapore round 17 sessions (Q, R, S, SQ). The local checkout matches repair staging for telemetry. The staged snapshot is evidence of the prepared repair payload, not independent proof of current production contents.

The database contains 77 seasons, 1,172 scheduled race rows, 1,166 races with results, 881 driver catalog rows, 214 constructor catalog rows, 78 circuit catalog rows, 635,331 lap timing rows, and 12,881 pit stop rows. The local SQLite file timestamp is 2026-10-12, so describe these as archived data coverage, not live site analytics.

Telemetry sample counts use the number of values in each driver's `speed` array, a single channel. Driver entries count each driver in each session; distinct drivers are unique driver codes across the entire source. These are coverage statistics, not website visits, unique visitors, or engagement metrics. The archive has 2,034,240 speed samples; repair staging and local have 2,059,840.
