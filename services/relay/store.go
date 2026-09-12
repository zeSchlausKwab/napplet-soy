package main

import (
	"context"
	"errors"
	"fmt"
	"iter"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"fiatjaf.com/nostr"
	"fiatjaf.com/nostr/eventstore"
	"fiatjaf.com/nostr/eventstore/lmdb"
	"fiatjaf.com/nostr/nip40"
	"github.com/blevesearch/bleve/v2"
	"github.com/blevesearch/bleve/v2/search/query"
	"golang.org/x/sys/unix"
)

// Signed events are authoritative. Search is disposable and rebuilt on startup,
// including after an unclean stop between the LMDB and Bleve writes.
type eventStore struct {
	mu      sync.RWMutex
	raw     *lmdb.LMDBBackend
	index   bleve.Index
	path    string
	healthy bool
	closed  bool
	lock    *os.File
}

func openStore(path string) (*eventStore, error) {
	if err := os.MkdirAll(path, 0700); err != nil {
		return nil, err
	}
	lock, err := os.OpenFile(filepath.Join(path, ".lock"), os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return nil, err
	}
	if err = unix.Flock(int(lock.Fd()), unix.LOCK_EX|unix.LOCK_NB); err != nil {
		lock.Close()
		return nil, fmt.Errorf("relay data directory is already in use: %w", err)
	}
	s := &eventStore{path: path, lock: lock, raw: &lmdb.LMDBBackend{Path: filepath.Join(path, "events"), MapSize: 1 << 30}}
	if err = s.raw.Init(); err != nil {
		lock.Close()
		return nil, err
	}
	if err = s.Init(); err != nil {
		s.raw.Close()
		lock.Close()
		return nil, err
	}
	return s, nil
}
func (s *eventStore) Init() error {
	path := filepath.Join(s.path, "search.bleve")
	if err := os.RemoveAll(path); err != nil {
		return err
	}
	mapping := bleve.NewIndexMapping()
	mapping.DefaultMapping.Dynamic = false
	text := bleve.NewTextFieldMapping()
	text.Store = false
	mapping.DefaultMapping.AddFieldMappingsAt("text", text)
	for _, field := range []string{"id", "author", "kind"} {
		mapping.DefaultMapping.AddFieldMappingsAt(field, bleve.NewKeywordFieldMapping())
	}
	mapping.DefaultMapping.AddFieldMappingsAt("created", bleve.NewNumericFieldMapping())
	mapping.DefaultMapping.AddFieldMappingsAt("expires", bleve.NewNumericFieldMapping())
	tagMapping := bleve.NewDocumentMapping()
	tagMapping.Dynamic = false
	for _, letter := range "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ" {
		tagMapping.AddFieldMappingsAt(string(letter), bleve.NewKeywordFieldMapping())
	}
	mapping.DefaultMapping.AddSubDocumentMapping("tags", tagMapping)
	index, err := bleve.New(path, mapping)
	if err != nil {
		return err
	}
	s.index = index
	batch := index.NewBatch()
	count, err := s.raw.CountEvents(nostr.Filter{})
	if err != nil {
		index.Close()
		return err
	}
	for e := range s.raw.QueryEvents(nostr.Filter{}, max(1, int(count))) {
		if err := batch.Index(e.ID.Hex(), searchDocument(e)); err != nil {
			index.Close()
			return err
		}
		if batch.Size() >= 100 {
			if err := index.Batch(batch); err != nil {
				index.Close()
				return err
			}
			batch = index.NewBatch()
		}
	}
	if err := index.Batch(batch); err != nil {
		index.Close()
		return err
	}
	s.healthy = true
	return nil
}
func expirationForIndex(e nostr.Event) nostr.Timestamp {
	if t := nip40.GetExpiration(e.Tags); t >= 0 {
		return t
	}
	return 1 << 53
}
func expired(e nostr.Event) bool { t := nip40.GetExpiration(e.Tags); return t >= 0 && t <= nostr.Now() }
func searchDocument(e nostr.Event) map[string]any {
	texts := []string{e.Content}
	tags := map[string][]string{}
	for _, t := range e.Tags {
		if len(t) < 2 {
			continue
		}
		if len(t[0]) == 1 {
			tags[t[0]] = append(tags[t[0]], t[1])
		}
		switch t[0] {
		case "title", "name", "description", "about", "t":
			texts = append(texts, t[1])
		}
	}
	return map[string]any{"text": strings.Join(texts, "\n"), "id": e.ID.Hex(), "author": e.PubKey.Hex(), "kind": strconv.Itoa(int(e.Kind)), "created": float64(e.CreatedAt), "expires": float64(expirationForIndex(e)), "tags": tags}
}
func (s *eventStore) Close() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return
	}
	s.closed = true
	s.healthy = false
	s.index.Close()
	s.raw.Close()
	s.lock.Close()
}
func (s *eventStore) SaveEvent(e nostr.Event) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return errors.New("store closed")
	}
	if s.deleted(e) {
		return errors.New("blocked: deleted publication")
	}
	err := s.raw.SaveEvent(e)
	if err != nil && !errors.Is(err, eventstore.ErrDupEvent) {
		return err
	}
	if ix := s.index.Index(e.ID.Hex(), searchDocument(e)); ix != nil {
		s.healthy = false
		return ix
	}
	return err
}
func (s *eventStore) ReplaceEvent(e nostr.Event) ([]nostr.Event, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return nil, errors.New("store closed")
	}
	if s.deleted(e) {
		return nil, errors.New("blocked: deleted publication")
	}
	for previous := range s.raw.QueryEvents(nostr.Filter{IDs: []nostr.ID{e.ID}}, 1) {
		if previous.ID == e.ID {
			return nil, eventstore.ErrDupEvent
		}
	}
	removed, err := s.raw.ReplaceEvent(e)
	if err != nil {
		return nil, err
	}
	present := false
	for stored := range s.raw.QueryEvents(nostr.Filter{IDs: []nostr.ID{e.ID}}, 1) {
		present = stored.ID == e.ID
	}
	if !present {
		return nil, eventstore.ErrDupEvent
	}
	batch := s.index.NewBatch()
	for _, old := range removed {
		batch.Delete(old.ID.Hex())
	}
	if err = batch.Index(e.ID.Hex(), searchDocument(e)); err == nil {
		err = s.index.Batch(batch)
	}
	if err != nil {
		s.healthy = false
	}
	return removed, err
}
func (s *eventStore) DeleteEvent(id nostr.ID) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return errors.New("store closed")
	}
	if err := s.raw.DeleteEvent(id); err != nil {
		return err
	}
	err := s.index.Delete(id.Hex())
	if err != nil {
		s.healthy = false
	}
	return err
}

var searchTokens = regexp.MustCompile(`"([^"]+)"|(\S+)`)

func searchQuery(f nostr.Filter) query.Query {
	terms := []query.Query{}
	for _, token := range searchTokens.FindAllStringSubmatch(f.Search, -1) {
		if token[1] != "" {
			q := bleve.NewMatchPhraseQuery(token[1])
			q.SetField("text")
			terms = append(terms, q)
		} else {
			q := bleve.NewMatchQuery(token[2])
			q.SetField("text")
			q.SetOperator(query.MatchQueryOperatorAnd)
			terms = append(terms, q)
		}
	}
	keyword := func(field string, values []string) {
		if len(values) == 0 {
			return
		}
		or := []query.Query{}
		for _, v := range values {
			q := bleve.NewTermQuery(v)
			q.SetField(field)
			or = append(or, q)
		}
		terms = append(terms, bleve.NewDisjunctionQuery(or...))
	}
	authors := []string{}
	for _, p := range f.Authors {
		authors = append(authors, p.Hex())
	}
	keyword("author", authors)
	ids := []string{}
	for _, id := range f.IDs {
		ids = append(ids, id.Hex())
	}
	keyword("id", ids)
	kinds := []string{}
	for _, k := range f.Kinds {
		kinds = append(kinds, strconv.Itoa(int(k)))
	}
	keyword("kind", kinds)
	for key, values := range f.Tags {
		keyword("tags."+key, values)
	}
	if f.Since != 0 || f.Until != 0 {
		var min, max *float64
		if f.Since != 0 {
			v := float64(f.Since)
			min = &v
		}
		if f.Until != 0 {
			v := float64(f.Until)
			max = &v
		}
		yes := true
		q := bleve.NewNumericRangeInclusiveQuery(min, max, &yes, &yes)
		q.SetField("created")
		terms = append(terms, q)
	}
	if len(terms) == 0 {
		return bleve.NewMatchAllQuery()
	}
	return bleve.NewConjunctionQuery(terms...)
}

// Deletion markers are durable, including markers received before their targets.
// Call with mu held; also check reads to survive a crash before physical deletion.
func (s *eventStore) deleted(e nostr.Event) bool {
	if e.Kind == 5 {
		return false
	}
	filters := []nostr.Filter{{Kinds: []nostr.Kind{5}, Authors: []nostr.PubKey{e.PubKey}, Tags: nostr.TagMap{"e": {e.ID.Hex()}}}}
	if e.Kind.IsAddressable() {
		filters = append(filters, nostr.Filter{Kinds: []nostr.Kind{5}, Authors: []nostr.PubKey{e.PubKey}, Since: e.CreatedAt, Tags: nostr.TagMap{"a": {fmt.Sprintf("%d:%s:%s", e.Kind, e.PubKey.Hex(), e.Tags.GetD())}}})
	}
	for _, f := range filters {
		for marker := range s.raw.QueryEvents(f, 1) {
			if f.Matches(marker) {
				return true
			}
		}
	}
	return false
}
func (s *eventStore) QueryEvents(f nostr.Filter, maxLimit int) iter.Seq[nostr.Event] {
	return s.queryStored(f, maxLimit, false)
}
func (s *eventStore) queryStored(f nostr.Filter, maxLimit int, includeDeleted bool) iter.Seq[nostr.Event] {
	return func(yield func(nostr.Event) bool) {
		// Release the database lock before writing to a potentially slow WebSocket.
		s.mu.RLock()
		result := s.query(f, maxLimit, includeDeleted)
		s.mu.RUnlock()
		for _, e := range result {
			if !yield(e) {
				return
			}
		}
	}
}
func (s *eventStore) query(f nostr.Filter, maxLimit int, includeDeleted bool) []nostr.Event {
	limit := min(maxLimit, f.GetTheoreticalLimit())
	if f.LimitZero || !s.healthy || s.closed {
		return nil
	}
	if f.Limit > 0 {
		limit = min(limit, f.Limit)
	}
	if limit <= 0 {
		return nil
	}
	found := make([]nostr.Event, 0, min(limit, 200))
	// All filters use the projection, then verify full event IDs and every NIP-01
	// predicate against LMDB. This also avoids upstream ID-only filter shortcuts.
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	for offset := 0; ctx.Err() == nil; offset += 100 {
		request := bleve.NewSearchRequestOptions(searchQuery(f), 100, offset, false)
		request.SortBy([]string{"-created", "id"})
		results, err := s.index.SearchInContext(ctx, request)
		if err != nil {
			return found
		}
		for _, hit := range results.Hits {
			id, err := nostr.IDFromHex(hit.ID)
			if err != nil {
				continue
			}
			for e := range s.raw.QueryEvents(nostr.Filter{IDs: []nostr.ID{id}}, 1) {
				if e.ID != id || !f.Matches(e) || expired(e) || (!includeDeleted && s.deleted(e)) {
					continue
				}
				found = append(found, e)
				if len(found) >= limit {
					return found
				}
			}
		}
		if len(results.Hits) < 100 {
			return found
		}
	}
	return found
}

// Expired content is immediately hidden on reads; periodic cleanup reclaims raw
// records too. Collect first because LMDB read transactions cannot contain writes.
func (s *eventStore) purgeExpired() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return nil
	}
	now := float64(nostr.Now())
	q := bleve.NewNumericRangeQuery(nil, &now)
	q.SetField("expires")
	request := bleve.NewSearchRequestOptions(q, 200, 0, false)
	result, err := s.index.Search(request)
	if err != nil {
		return err
	}
	for _, hit := range result.Hits {
		id, err := nostr.IDFromHex(hit.ID)
		if err != nil {
			continue
		}
		for e := range slices.Values(slices.Collect(s.raw.QueryEvents(nostr.Filter{IDs: []nostr.ID{id}}, 1))) {
			if expired(e) {
				if err = s.raw.DeleteEvent(id); err != nil {
					return err
				}
				if err = s.index.Delete(hit.ID); err != nil {
					s.healthy = false
					return err
				}
			}
		}
	}
	return nil
}
func (s *eventStore) check() error {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if !s.healthy {
		return fmt.Errorf("search projection unavailable; restart to rebuild")
	}
	return nil
}
