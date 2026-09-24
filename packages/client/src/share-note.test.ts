import { test, expect } from 'bun:test';
import { finalizeEvent } from 'nostr-tools';
import {
  createShareDraft,
  editShareDraft,
  toggleSharePart,
  shareNoteTemplate,
  shareMedia,
} from './share-note';

const source = {
  title: 'Limb racer',
  description: 'Draw a car and try the hills.',
  topics: ['game', 'Racing', 'game'],
};
const player = 'https://napplet.soy/r/abc/play';
test('share toggles remove and restore edited fragments without rebuilding other prose', () => {
  let draft = createShareDraft(source, player);
  expect(draft.content).toContain('#nappletsoy #game #racing');
  draft = editShareDraft(draft, draft.content.replace('Limb racer', 'My favourite racer!'));
  draft = editShareDraft(draft, draft.content + '\n\nTry beating me.');
  draft = toggleSharePart(draft, 'description');
  expect(draft.content).not.toContain(source.description);
  expect(draft.content).toContain('My favourite racer!');
  expect(draft.content).toContain('Try beating me.');
  draft = toggleSharePart(draft, 'title');
  expect(draft.content).not.toContain('My favourite racer!');
  draft = toggleSharePart(draft, 'title');
  expect(draft.content.endsWith('My favourite racer!')).toBe(true);
  draft = toggleSharePart(draft, 'topics');
  expect(draft.content).not.toContain('#game');
  expect(draft.content).toContain('#nappletsoy');
  expect(draft.content).toContain('Try beating me.');
});
test('freeform replacement, manual removal, unicode edits and absent descriptions stay editable', () => {
  let draft = createShareDraft({ ...source, description: '' }, player);
  expect(draft.parts.some((part) => part.id === 'description')).toBe(false);
  draft = editShareDraft(draft, 'Play this 💚 #nostr');
  expect(draft.parts.every((part) => part.start === null)).toBe(true);
  expect(toggleSharePart(draft, 'player').content).toBe(`Play this 💚 #nostr\n\n${player}`);
  let tags = createShareDraft(source, player);
  tags = editShareDraft(tags, tags.content.replace('#nappletsoy', ''));
  expect(tags.parts.find((part) => part.id === 'soy')?.start).toBeNull();
  tags = toggleSharePart(tags, 'topics');
  expect(tags.content).not.toContain('#game');
});
test('note tags follow the edited content and media metadata cannot survive removal', () => {
  const media = {
    type: 'video' as const,
    url: 'https://blossom.example/clip',
    hash: 'a'.repeat(64),
  };
  const text = `  My edit #NaPpLeTsOy #game #GAME #日本語.\n${media.url}\n${player}  `;
  const note = shareNoteTemplate(text, media);
  expect(note).toMatchObject({ kind: 1, content: text });
  expect(note.tags.filter((tag) => tag[0] === 't')).toEqual([
    ['t', 'nappletsoy'],
    ['t', 'game'],
    ['t', '日本語'],
  ]);
  expect(note.tags.find((tag) => tag[0] === 'imeta')).toContain(`url ${media.url}`);
  expect(note.tags.some((tag) => ['e', 'a', 'p'].includes(tag[0]))).toBe(false);
  expect(shareNoteTemplate('Completely my own text', media).tags).toEqual([]);
  expect(
    shareNoteTemplate(`${media.url}-not-the-clip https://example.com/#notatag`, media).tags,
  ).toEqual([]);
  expect(() => shareNoteTemplate('  ')).toThrow('Write a note');
  expect(() => shareNoteTemplate('a'.repeat(10001))).toThrow('10,000');
});
test('media uses signed descriptor links, prefers clips, then the main image, and tolerates no assets', () => {
  const key = new Uint8Array(32);
  key[31] = 1;
  const image = 'https://blossom.example/cover.png',
    video = 'https://blossom.example/clip.webm';
  const descriptor = (withVideo: boolean) =>
    finalizeEvent(
      {
        kind: 32267,
        created_at: 1,
        content: withVideo ? video : '',
        tags: [
          ['d', 'app'],
          ['image', image],
          ...(withVideo ? [['imeta', `url ${video}`, 'm video/webm', `x ${'a'.repeat(64)}`]] : []),
        ],
      },
      key,
    );
  const info = descriptor(true);
  const manifest = finalizeEvent(
    { kind: 35129, created_at: 1, content: '', tags: [['app', `32267:${info.pubkey}:app`]] },
    key,
  );
  expect(shareMedia({ manifest, metadata: [info] })).toMatchObject({ type: 'video', url: video });
  expect(shareMedia({ manifest, metadata: [descriptor(false)] })).toEqual({
    type: 'image',
    url: image,
  });
  expect(shareMedia({ manifest })).toBeUndefined();
  expect(shareMedia({ manifest, metadata: [{ ...info, content: 'forged' }] })).toBeUndefined();
});
