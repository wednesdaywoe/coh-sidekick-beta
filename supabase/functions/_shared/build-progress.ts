/**
 * Which shared builds may carry their owner's shopping progress.
 *
 * A saved build can hold `build.progress`: the enhancements and incarnate
 * salvage the owner has ticked off as bought. That describes the owner's
 * inventory, not the build, so it may live only on a row nobody else can
 * read. `get-build` answers by id for `public` and `unlisted`, so only a
 * `private` row keeps it. Same shape as the F08 preview rule
 * (`preview-visibility.ts`): one predicate, failing closed.
 */

/**
 * May a build at this visibility keep its progress? Unknown or absent is
 * `false`, because this is the only thing removing it.
 */
export function progressMayStay(visibility: string | null | undefined): boolean {
  return visibility === 'private';
}

/**
 * `build_json` without `build.progress`. Anything that is not the expected
 * shape comes back unchanged, so a malformed body is refused where it always
 * was rather than here.
 */
export function withoutProgress(buildJson: unknown): unknown {
  if (!buildJson || typeof buildJson !== 'object') return buildJson;
  const envelope = buildJson as { build?: unknown };
  if (!envelope.build || typeof envelope.build !== 'object') return buildJson;
  if (!('progress' in envelope.build)) return buildJson;
  const { progress: _progress, ...build } = envelope.build as Record<string, unknown>;
  void _progress;
  return { ...envelope, build };
}
