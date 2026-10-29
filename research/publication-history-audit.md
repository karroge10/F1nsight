# Recovered pre-race evidence

## Singapore 2026 R17

The project log contains a pre-race winner pick. On 9 October 2026 at 20:04:43 UTC, its entry at position 570 records the recalculated Singapore forecast after applying Russell's grid penalty: Verstappen became the favourite at a rounded 29% win probability. The same entry lists Leclerc 16%, Antonelli 14%, Hamilton 11%, Norris 10%, and Russell 5%. It does not contain the full driver field.

Source: [Deploy project log](t3-thread://v1/50940139-d87d-48a7-92f1-544c363cec06). Entry 619, timestamped 9 October at 20:42 UTC, records a successful local site rebuild. The scheduled race start was 11 October at 12:00 UTC. This documents a correct pre-race favourite and a local build, but does not independently verify a public deployment or recover a complete forecast artifact.

The later retrospective post-qualifying backtest gives Verstappen 53.3%. That is a separate forecast and cannot be substituted for the earlier 29% pick.

Git commit `4c1d6fd` contains a complete `site/src/lib/data/fixtures/predictions/next.json` for Singapore. Its internal generation time is 7 October 2026 at 07:03:26 UTC and its pre-weekend favourite is Verstappen at 20.8%. However, the commit time is 12 October 2026, after the race. The internal generation time alone is insufficient to certify that full artifact as a pre-race publication.

The race UI therefore labels the recovered 29% pick as documented in the project log. Exact-position accuracy and driver-by-driver comparisons remain explicitly retrospective. The recovered partial record is not used to calculate full-field probability scores.

## Search scope

An additional pre-race Austin example appears in the same project log at position 794, timestamped 12 October 2026 at 10:10:22 UTC. It gives the newly promoted model's pre-weekend favourite as Verstappen at 22.5%, followed by Antonelli at 16.7%. This is an earlier forecast version, not the later post-qualifying backtest that picked Antonelli. A dated forecast version must not be replaced with a more successful retrospective version when reporting performance. The message does not provide the complete field or an artifact hash, and does not independently establish that version's public deployment.

The Austin example is not added to the full-field score calculations or treated as the final forecast at race start. There were subsequent model and market-blend changes before the race, so selecting this isolated version as the definitive final publication would also be unjustified.

- Git history across all refs for `**/predictions/next.json` and `**/forecast.json`.
- Project thread searches for Singapore, forecast, winner, and the reported 53.3% figure.
- The dated project-log messages around the Singapore practice update, grid-penalty correction, and local rebuild.

No complete timestamp-verified pre-race publication was recovered from these sources. This is a limit of the recovered evidence, not a claim that no forecast existed before the race.
