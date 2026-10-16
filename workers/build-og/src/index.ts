/**
 * Cloudflare Worker on coh-sidekick.com/builds/* — injects per-build
 * og:title/og:description/og:image tags for a shared build's link.
 *
 * Why a Worker at all: the site is a static SPA on GitHub Pages with no
 * per-path server templating, and GitHub Pages' SPA-fallback for an unknown
 * path (`/builds/:id`) is a bare 404.html that does a client-side
 * `location.replace('/')` redirect — it carries NONE of the og:* tags a
 * crawler needs, and a crawler never runs the redirect's JS anyway. So this
 * Worker fetches the REAL shell from `/` (which has the generic site-wide
 * tags), rewrites those tags with per-build values, and serves that shell
 * directly at the `/builds/:id` URL with a 200 — which also means a human
 * hitting the link skips the redirect round-trip GitHub Pages would have
 * done. See streams/BUILD_PREVIEW_IMAGE_PLAN.md (build-preview-image-4).
 *
 * Unconditional rewrite for every request on the route (no bot-UA sniffing —
 * harmless for humans, avoids UA-list fragility). A private build, an
 * unknown id, or a lookup failure all fall through to the shell's own
 * generic tags untouched — this Worker can only ever ADD per-build info, on
 * top of a shell it never modifies the script/CSP content of.
 */

export interface Env {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
}

interface BuildMeta {
  name: string;
  archetype_name: string;
  primary_name: string;
  secondary_name: string;
  level: number;
  preview_image_path: string | null;
  preview_template_version: number | null;
  updated_at: string | null;
}

const BUILD_PATH = /^\/builds\/([^/]+)\/?$/;

/**
 * The rasterized card's real size. The shell's static og:image:width/height
 * describe the site-wide fallback image (1200×630) and are left alone when
 * this Worker has no per-build image to point at — but once it rewrites
 * og:image they have to move with it, or the tags declare 630 for an 880-tall
 * picture and a crawler lays the embed out against the wrong box.
 *
 * Hand-duplicated from PREVIEW_CARD_WIDTH / PREVIEW_CARD_HEIGHT in
 * src/components/export-image/BuildPreviewCard.tsx — a Worker bundle can't
 * import from the app's path aliases. Update both.
 */
const PREVIEW_CARD_WIDTH = 1200;
const PREVIEW_CARD_HEIGHT = 880;

/**
 * Query suffix that makes the og:image URL change whenever the picture behind
 * it does. The stored path is `previews/<id>.png` and never varies, and
 * Discord's media proxy caches by image URL — so without this a regenerated
 * image is invisible to every client that ever fetched the old one, even from
 * a page URL Discord has never seen before. Measured 2026-09-03: a
 * first-time-scraped `?v=3` page URL still embedded a two-generations-old
 * picture.
 *
 * Two keys because two different things regenerate an image: a template bump
 * moves `preview_template_version`, and editing then re-sharing a build moves
 * `updated_at` while the version stays put. Storage ignores both.
 */
function previewCacheKey(build: BuildMeta): string {
  const version = build.preview_template_version ?? 0;
  const stamp = build.updated_at ? Date.parse(build.updated_at) : NaN;
  return `v=${version}&t=${Number.isNaN(stamp) ? 0 : stamp}`;
}

/**
 * Point lookup via the get-build edge function — the only path a non-owner
 * reads an unlisted build through (RLS grants unlisted rows no anon read;
 * see schema.sql). Returns null for unknown id, private (not readable
 * anonymously), or any request failure — every case this Worker treats the
 * same way: fall through to the shell's generic tags.
 */
async function lookupBuild(id: string, env: Env): Promise<BuildMeta | null> {
  try {
    const res = await fetch(`${env.SUPABASE_URL}/functions/v1/get-build`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: env.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({ id }),
    });
    if (!res.ok) return null;
    return (await res.json()) as BuildMeta;
  } catch {
    return null;
  }
}

class SetAttrHandler implements HTMLRewriterElementContentHandlers {
  constructor(
    private attr: string,
    private value: string,
  ) {}
  element(el: Element) {
    el.setAttribute(this.attr, this.value);
  }
}

class SetTextHandler implements HTMLRewriterElementContentHandlers {
  constructor(private value: string) {}
  element(el: Element) {
    el.setInnerContent(this.value);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const match = url.pathname.match(BUILD_PATH);

    // Not a single build's detail page (e.g. /builds itself, the browse
    // list) — this Worker has nothing build-specific to inject, passthrough.
    if (!match) return fetch(request);

    const id = match[1];
    const [build, shell] = await Promise.all([
      lookupBuild(id, env),
      fetch(new URL('/', url)),
    ]);

    if (!build) return shell;

    const title = `${build.name} — ${build.archetype_name} (${build.primary_name}/${build.secondary_name}), Lvl ${build.level}`;
    const description = `A level ${build.level} ${build.archetype_name} build: ${build.primary_name} / ${build.secondary_name}. View the full build on Sidekick.`;
    const canonicalUrl = `https://coh-sidekick.com/builds/${id}`;
    const imageUrl = build.preview_image_path
      ? `${env.SUPABASE_URL}/storage/v1/object/public/build-previews/${build.preview_image_path}?${previewCacheKey(build)}`
      : null;

    const rewriter = new HTMLRewriter()
      .on('title', new SetTextHandler(`${title} - Sidekick`))
      .on('meta[property="og:title"]', new SetAttrHandler('content', title))
      .on('meta[name="twitter:title"]', new SetAttrHandler('content', title))
      .on('meta[property="og:description"]', new SetAttrHandler('content', description))
      .on('meta[name="twitter:description"]', new SetAttrHandler('content', description))
      .on('meta[property="og:url"]', new SetAttrHandler('content', canonicalUrl));

    if (imageUrl) {
      rewriter
        .on('meta[property="og:image"]', new SetAttrHandler('content', imageUrl))
        .on('meta[name="twitter:image"]', new SetAttrHandler('content', imageUrl))
        .on('meta[property="og:image:width"]', new SetAttrHandler('content', String(PREVIEW_CARD_WIDTH)))
        .on('meta[property="og:image:height"]', new SetAttrHandler('content', String(PREVIEW_CARD_HEIGHT)));
    }

    return rewriter.transform(shell);
  },
};
