import { PublishError, projectSchema } from './config';

/** Source HTML remains source; the generated HTML is the executable release. */
export function executableEntry(contents: Map<string, Uint8Array>) {
  return projectSchema.parse(JSON.parse(new TextDecoder().decode(contents.get('napplet.json'))))
    .entry;
}

export function executableBytes(contents: Map<string, Uint8Array>) {
  const bytes = contents.get(executableEntry(contents));
  if (!bytes)
    throw new PublishError(
      'ARTIFACT_MISSING',
      'Build the project before checking or publishing: napplet-space build.',
    );
  return bytes;
}

/** Read metadata emitted by the upstream Vite plugin without executing project code. */
export async function builtRequirements(html: Uint8Array) {
  const requirements: string[] = [];
  const response = new HTMLRewriter()
    .on('meta[name="napplet-requires"]', {
      element(element) {
        requirements.push(
          ...(element.getAttribute('content') || '')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
        );
      },
    })
    .transform(new Response(new Uint8Array(html)));
  await response.arrayBuffer();
  if (
    requirements.length > 32 ||
    requirements.some((value) => !/^[a-z][a-z0-9-]{0,39}$/.test(value))
  )
    throw new PublishError('PROJECT_CAPABILITY', 'Invalid required domains in the built artifact.');
  return [...new Set(requirements)];
}
