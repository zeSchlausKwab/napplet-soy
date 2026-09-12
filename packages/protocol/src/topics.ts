/** A bounded display/search projection of optional NIP-24 `t` tags. Never edits an event. */
export function normalizeTopic(value: string): string {
  if (value.length > 256) return '';
  const topic = value.trim().replace(/^#/, '').normalize('NFC').toLowerCase();
  if (
    !topic ||
    Array.from(topic).length > 64 ||
    /[\s#\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(topic)
  )
    return '';
  return topic;
}

/** Call on a validated manifest. Missing or unusable topics never affect admission. */
export function manifestTopics(event: { tags: readonly (readonly string[])[] }): string[] {
  const topics = new Set<string>();
  for (const tag of event.tags) {
    if (tag[0] !== 't' || !tag[1]) continue;
    const topic = normalizeTopic(tag[1]);
    if (topic) topics.add(topic);
    if (topics.size === 32) break;
  }
  return [...topics];
}

type SearchableNapplet = {
  title: string;
  description: string;
  creator: string;
  topics: readonly string[];
};

/** The same subject and text filters apply regardless of discovery source. */
export function matchesGallery(napplet: SearchableNapplet, search: { tag: string; q: string }) {
  const query = search.q.trim().toLowerCase();
  return (
    (!search.tag || napplet.topics.includes(search.tag)) &&
    (!query ||
      `${napplet.title} ${napplet.description} ${napplet.creator} ${napplet.topics.map((t) => `#${t}`).join(' ')}`
        .toLowerCase()
        .includes(query))
  );
}

export function topicFacets(napplets: readonly SearchableNapplet[]) {
  const counts = new Map<string, number>();
  for (const napplet of napplets)
    for (const topic of new Set(napplet.topics)) counts.set(topic, (counts.get(topic) ?? 0) + 1);
  return [...counts]
    .map(([topic, count]) => ({ topic, count }))
    .sort((a, b) => b.count - a.count || (a.topic < b.topic ? -1 : a.topic > b.topic ? 1 : 0));
}
