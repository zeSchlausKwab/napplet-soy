import { createFileRoute, Link, notFound } from '@tanstack/react-router';
import { getSource } from '@/lib/catalog.functions';
export const Route = createFileRoute('/r/$snapshot/source')({
  loader: async ({ params }) => {
    if (!/^[a-f0-9]{64}$/.test(params.snapshot)) throw notFound();
    const result = await getSource({ data: params.snapshot });
    if (!result) throw notFound();
    return result;
  },
  component: Source,
});
function Source() {
  const { release, source } = Route.useLoaderData();
  return (
    <section className="source-page">
      <Link
        className="back-link"
        to="/r/$snapshot"
        params={{ snapshot: 'provenance' in release ? release.revisionId : release.snapshot.id }}
      >
        ← Back to {release.title}
      </Link>
      <span className="eyebrow">
        {'provenance' in release ? 'VERIFIED HTML / SEE ORIGINAL LICENSE' : 'OPEN SOURCE / MIT'}
      </span>
      <h1>Nothing up our sleeves.</h1>
      <p>The complete HTML for this exact release. Code, style, and a little bit of weird.</p>
      <div className="source-toolbar">
        <span>index.html</span>
        <a href={`/api/artifacts/${release.artifactHash}`} download={`${release.slug}.html`}>
          Download source ↓
        </a>
      </div>
      <pre tabIndex={0}>
        <code>{source}</code>
      </pre>
    </section>
  );
}
