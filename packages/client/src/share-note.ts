import type { SignedEvent } from '../../protocol/src';
import { linkedMedia } from '../../protocol/src/linked-media';
import { normalizeTopic } from '../../protocol/src/topics';

export type ShareMedia = { url: string; type: 'video' | 'image'; hash?: string };
export type ShareNoteSource = {
  title: string;
  description: string;
  topics: string[];
  media?: ShareMedia;
};

/** Prefer the original clip, then the original cover. No generated/proxied assets. */
export function shareMedia(source: {
  manifest: SignedEvent;
  metadata?: SignedEvent[];
  video?: { url: string; hash: string; descriptor: SignedEvent } | null;
  preview?: { url: string; descriptor: SignedEvent; profile?: SignedEvent } | null;
}): ShareMedia | undefined {
  const linked = linkedMedia(source.manifest, [
    ...(source.metadata ?? []),
    ...(source.video ? [source.video.descriptor] : []),
    ...(source.preview ? [source.preview.descriptor] : []),
    ...(source.preview?.profile ? [source.preview.profile] : []),
  ]);
  const video = linked.videos.find((v) => v.url === source.video?.url) ?? linked.videos[0];
  if (video) return { ...video, type: 'video' };
  const image = linked.images.find((url) => url === source.preview?.url) ?? linked.images[0];
  return image ? { url: image, type: 'image' } : undefined;
}

type Part = { id: string; label: string; text: string; start: number | null; end: number | null };
export type ShareDraft = { content: string; parts: Part[] };
export function createShareDraft(source: ShareNoteSource, playerUrl: string): ShareDraft {
  const description = source.description.replace(/\s+/g, ' ').trim();
  const topics = [...new Set(source.topics.map(normalizeTopic).filter(Boolean))]
    .filter((tag) => tag !== 'nappletsoy')
    .map((tag) => `#${tag}`)
    .join(' ');
  const values = [
    ['title', 'Title', source.title],
    [
      'description',
      'Description',
      description.length > 240 ? `${description.slice(0, 237).trimEnd()}…` : description,
    ],
    [
      'media',
      source.media?.type === 'video' ? 'Preview clip' : 'Cover image',
      source.media?.url ?? '',
    ],
    ['player', 'Fullscreen link', playerUrl],
    ['soy', '#nappletsoy', '#nappletsoy'],
    ['topics', 'Napplet tags', topics],
  ];
  let content = '';
  const parts = values
    .filter(([, , text]) => text)
    .map(([id, label, text]) => {
      if (content) content += id === 'topics' ? ' ' : '\n\n';
      const start = content.length;
      content += text;
      return { id, label, text, start, end: content.length };
    });
  return { content, parts };
}

/** Track each generated fragment through textarea edits; never regenerate the user's prose. */
export function editShareDraft(draft: ShareDraft, content: string): ShareDraft {
  const old = draft.content;
  let start = 0,
    end = old.length,
    nextEnd = content.length;
  while (start < end && start < nextEnd && old[start] === content[start]) start++;
  while (end > start && nextEnd > start && old[end - 1] === content[nextEnd - 1]) {
    end--;
    nextEnd--;
  }
  const delta = nextEnd - end;
  const inserted = content.slice(start, nextEnd);
  return {
    content,
    parts: draft.parts.map((part) => {
      if (part.start === null || part.end === null) return part;
      // Insertions at a paragraph boundary belong to newly typed prose.
      if (end <= part.start && (start < part.start || inserted.includes('\n')))
        return { ...part, start: part.start + delta, end: part.end + delta };
      if (start >= part.end && (start > part.end || inserted.includes('\n'))) return part;
      if (start >= part.start && end <= part.end) {
        const next = part.end + delta;
        return next > part.start
          ? { ...part, end: next, text: content.slice(part.start, next) }
          : { ...part, start: null, end: null };
      }
      // A replacement spanning fragments is freeform text, no longer owned by a toggle.
      return { ...part, start: null, end: null };
    }),
  };
}

export function toggleSharePart(draft: ShareDraft, id: string): ShareDraft {
  const part = draft.parts.find((p) => p.id === id);
  if (!part) return draft;
  if (part.start !== null && part.end !== null) {
    let start = part.start,
      end = part.end;
    // Remove only the fragment and its adjacent separator, never other prose.
    const following = /^\s*/.exec(draft.content.slice(end))![0];
    if (following) end += following.length;
    else start -= /\s*$/.exec(draft.content.slice(0, start))![0].length;
    const content = draft.content.slice(0, start) + draft.content.slice(end);
    return {
      content,
      parts: draft.parts.map((p) =>
        p.id === id
          ? { ...p, text: draft.content.slice(part.start!, part.end!), start: null, end: null }
          : p.start !== null && p.start >= end
            ? { ...p, start: p.start - (end - start), end: p.end! - (end - start) }
            : p,
      ),
    };
  }
  // Restoring a fragment appends it, preserving all freeform edits and their order.
  const prefix = draft.content ? '\n\n' : '';
  const start = draft.content.length + prefix.length;
  return {
    content: draft.content + prefix + part.text,
    parts: draft.parts.map((p) => (p.id === id ? { ...p, start, end: start + p.text.length } : p)),
  };
}

export const MAX_SHARE_CHARACTERS = 10000;
export function shareNoteTemplate(content: string, media?: ShareMedia) {
  if (!content.trim()) throw new Error('Write a note before posting.');
  if (content.length > MAX_SHARE_CHARACTERS)
    throw new Error('Keep the note under 10,000 characters.');
  const urls = new Set(content.match(/https?:\/\/[^\s<>"`]+/g) ?? []);
  // URL fragments aren't hashtags. Tags follow the actual edited text, not hidden defaults.
  const prose = content.replace(/https?:\/\/[^\s<>"`]+/g, '');
  const topics = new Set<string>();
  for (const match of prose.matchAll(/(?:^|[\s(])#([^\s#]+)/gu)) {
    const topic = normalizeTopic(match[1].replace(/[.,!?;:)\]}]+$/g, ''));
    if (topic) topics.add(topic);
  }
  if (topics.size > 128) throw new Error('Use at most 128 hashtags in one note.');
  const tags: string[][] = [...topics].map((topic) => ['t', topic]);
  if (media && urls.has(media.url)) {
    tags.push([
      'imeta',
      `url ${media.url}`,
      `alt Napplet ${media.type === 'video' ? 'preview clip' : 'cover image'}`,
      ...(media.hash ? [`x ${media.hash}`] : []),
      ...(media.type === 'video' ? ['m video/webm'] : []),
    ]);
  }
  return { kind: 1, content, tags, created_at: Math.floor(Date.now() / 1000) };
}
