package main

import (
	"encoding/json"
	"fiatjaf.com/nostr"
	"os"
	"path/filepath"
	"testing"
)

func TestOperatorPolicyBlocksStoredSearchLiveAndFuturePublications(t *testing.T) {
	path := filepath.Join(t.TempDir(), "policy.json")
	write := func(rules []map[string]string) {
		t.Helper()
		data, _ := json.Marshal(map[string]any{"version": 1, "rules": rules})
		if err := os.WriteFile(path+".next", data, 0600); err != nil {
			t.Fatal(err)
		}
		if err := os.Rename(path+".next", path); err != nil {
			t.Fatal(err)
		}
	}
	write([]map[string]string{})
	t.Setenv("SPACE_MODERATION_FILE", path)
	s := testStore(t)
	key := nostr.Generate()
	e := fixture(t, key, 35129, nostr.Now(), nostr.Tags{{"d", "test"}, {"title", "Test publication"}}, "")
	put(t, s, e)
	address := "35129:" + e.PubKey.Hex() + ":test"
	snap := fixture(t, key, 5129, nostr.Now(), nostr.Tags{{"a", address}}, "")
	put(t, s, snap)
	relay := newRelay(s)
	write([]map[string]string{{"type": "address", "target": address}})
	for _, f := range []nostr.Filter{{IDs: []nostr.ID{e.ID}}, {Search: "publication"}, {IDs: []nostr.ID{snap.ID}}} {
		if len(events(s, f)) != 0 {
			t.Fatal("blocked stored event returned")
		}
	}
	if !relay.PreventBroadcast(nil, nostr.Filter{}, e) {
		t.Fatal("live broadcast bypassed block")
	}
	if _, err := s.ReplaceEvent(fixture(t, key, 35129, nostr.Now()+1, e.Tags, "update")); err == nil {
		t.Fatal("new revision accepted")
	}
	foreign := fixture(t, nostr.Generate(), 5129, nostr.Now(), nostr.Tags{{"a", address}}, "")
	if s.moderation.blocked(foreign) {
		t.Fatal("snapshot link trusted another author")
	}
	write([]map[string]string{{"type": "pubkey", "target": e.PubKey.Hex()}})
	deletion := fixture(t, key, 5, nostr.Now(), nostr.Tags{{"e", e.ID.Hex()}}, "")
	if err := s.SaveEvent(deletion); err != nil {
		t.Fatal("blocked author cannot delete", err)
	}
	write([]map[string]string{})
	if s.moderation.blocked(snap) {
		t.Fatal("unblock did not reload")
	}
	if err := os.WriteFile(path, []byte("broken"), 0600); err != nil {
		t.Fatal(err)
	}
	if !s.moderation.blocked(foreign) || s.moderation.check() == nil {
		t.Fatal("corrupt policy failed open")
	}
}
