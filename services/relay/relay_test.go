package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"fiatjaf.com/nostr"
	"github.com/fasthttp/websocket"
)

func socket(t *testing.T, url string) *websocket.Conn {
	t.Helper()
	ws, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(url, "http"), nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { ws.Close() })
	return ws
}
func read(t *testing.T, ws *websocket.Conn) []json.RawMessage {
	t.Helper()
	ws.SetReadDeadline(time.Now().Add(5 * time.Second))
	var msg []json.RawMessage
	if err := ws.ReadJSON(&msg); err != nil {
		t.Fatal(err)
	}
	return msg
}
func publish(t *testing.T, ws *websocket.Conn, e nostr.Event, want bool) {
	t.Helper()
	if err := ws.WriteJSON([]any{"EVENT", e}); err != nil {
		t.Fatal(err)
	}
	for {
		msg := read(t, ws)
		if string(msg[0]) != `"OK"` {
			continue
		}
		if string(msg[1]) != `"`+e.ID.Hex()+`"` || string(msg[2]) != map[bool]string{true: "true", false: "false"}[want] {
			t.Fatalf("unexpected acknowledgement: %s", msg)
		}
		return
	}
}
func queryRelay(t *testing.T, ws *websocket.Conn, f nostr.Filter) []nostr.Event {
	t.Helper()
	ws.WriteJSON([]any{"REQ", "test", f})
	var result []nostr.Event
	for {
		msg := read(t, ws)
		switch string(msg[0]) {
		case `"EVENT"`:
			var e nostr.Event
			if err := json.Unmarshal(msg[2], &e); err != nil {
				t.Fatal(err)
			}
			result = append(result, e)
		case `"EOSE"`:
			ws.WriteJSON([]any{"CLOSE", "test"})
			return result
		case `"CLOSED"`:
			t.Fatalf("query refused: %s", msg)
		}
	}
}
func TestRelayProtocolRoundTrip(t *testing.T) {
	s := testStore(t)
	relay := newRelay(s)
	server := httptest.NewServer(relay)
	defer server.Close()
	ws := socket(t, server.URL)
	key := nostr.Generate()
	now := nostr.Now()
	e := fixture(t, key, 35129, now-1, nostr.Tags{{"d", "orbit"}, {"title", "Lunar garden"}, {"t", "visuals"}}, "")
	bad := e
	bad.Content = "tampered"
	publish(t, ws, bad, false)
	bad = e
	bad.Sig[0] ^= 1
	publish(t, ws, bad, false)
	publish(t, ws, e, true)
	publish(t, ws, e, true)
	got := queryRelay(t, ws, nostr.Filter{Search: `"lunar garden"`, Kinds: []nostr.Kind{35129}, Tags: nostr.TagMap{"t": {"visuals"}}})
	if len(got) != 1 || got[0].ID != e.ID {
		t.Fatal("ordinary NIP-50 query did not return published napplet")
	}
	attacker := fixture(t, nostr.Generate(), 5, now, nostr.Tags{{"e", e.ID.Hex()}}, "")
	publish(t, ws, attacker, false)
	if len(queryRelay(t, ws, nostr.Filter{IDs: []nostr.ID{e.ID}})) != 1 {
		t.Fatal("other author deleted event")
	}
	deletion := fixture(t, key, 5, now, nostr.Tags{{"a", "35129:" + e.PubKey.Hex() + ":orbit"}}, "")
	publish(t, ws, deletion, true)
	for range s.raw.QueryEvents(nostr.Filter{IDs: []nostr.ID{e.ID}}, 1) {
		t.Fatal("owned deletion did not remove durable target")
	}
	if len(queryRelay(t, ws, nostr.Filter{Search: "lunar"})) != 0 {
		t.Fatal("deleted napplet still searchable")
	}
	publish(t, ws, e, false)
	next := fixture(t, key, 35129, now+1, nostr.Tags{{"d", "orbit"}, {"title", "New garden"}}, "")
	publish(t, ws, next, true)
	if len(queryRelay(t, ws, nostr.Filter{Search: "garden"})) != 1 {
		t.Fatal("new revision after address deletion refused")
	}
	req, _ := http.NewRequest("GET", server.URL, nil)
	req.Header.Set("Accept", "application/nostr+json")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var info struct {
		SupportedNIPs []int `json:"supported_nips"`
	}
	if err = json.NewDecoder(res.Body).Decode(&info); err != nil {
		t.Fatal(err)
	}
	found := false
	for _, nip := range info.SupportedNIPs {
		if nip == 50 {
			found = true
		}
	}
	if !found {
		t.Fatal("NIP-50 not advertised")
	}
}

// Public app-data access is an intentional operator convention, not NIP-78's
// owner-only AUTH recommendation. A successful write alone does not prove this.
func TestPublicAppDataAcrossAnonymousConnections(t *testing.T) {
	s := testStore(t)
	server := httptest.NewServer(newRelay(s))
	defer server.Close()
	writer, reader := socket(t, server.URL), socket(t, server.URL)
	key := nostr.Generate()
	tags := nostr.Tags{{"d", "soy.app-data/1:scope:tracks:one"}, {"s", "scope"}, {"c", "tracks"}, {"L", "soy.app-data/1"}, {"l", "example.track", "soy.app-data/1"}, {"v", "1"}}
	first := fixture(t, key, 30078, nostr.Now()-2, tags, `{"data":{"points":[1,2]}}`)
	publish(t, writer, first, true)
	filter := nostr.Filter{Kinds: []nostr.Kind{30078}, Tags: nostr.TagMap{"L": {"soy.app-data/1"}, "s": {"scope"}, "c": {"tracks"}}}
	got := queryRelay(t, reader, filter)
	if len(got) != 1 || got[0].ID != first.ID {
		t.Fatal("app record unavailable to an anonymous connection")
	}
	second := fixture(t, key, 30078, nostr.Now()-1, tags, `{"data":{"points":[3,4]}}`)
	publish(t, writer, second, true)
	got = queryRelay(t, reader, filter)
	if len(got) != 1 || got[0].ID != second.ID {
		t.Fatal("addressable update did not replace current app record")
	}
	other := fixture(t, nostr.Generate(), 30078, nostr.Now(), tags, `{"data":{"points":[5,6]}}`)
	publish(t, writer, other, true)
	if len(queryRelay(t, reader, filter)) != 2 {
		t.Fatal("same d-tag under another author overwrote a record")
	}
}

func TestLiveSearchAndUnknownDeletionTarget(t *testing.T) {
	s := testStore(t)
	relay := newRelay(s)
	server := httptest.NewServer(relay)
	defer server.Close()
	publisher, subscriber := socket(t, server.URL), socket(t, server.URL)
	subscriber.WriteJSON([]any{"REQ", "live", nostr.Filter{Kinds: []nostr.Kind{35129}, Search: "garden", LimitZero: true}})
	if msg := read(t, subscriber); string(msg[0]) != `"EOSE"` {
		t.Fatalf("expected EOSE: %s", msg)
	}
	key := nostr.Generate()
	now := nostr.Now()
	noMatch := fixture(t, key, 35129, now, nostr.Tags{{"d", "orbit"}, {"title", "Lunar orbit"}}, "")
	publish(t, publisher, noMatch, true)
	match := fixture(t, key, 35129, now, nostr.Tags{{"d", "garden"}, {"title", "Pixel garden"}}, "")
	publish(t, publisher, match, true)
	msg := read(t, subscriber)
	var got nostr.Event
	if len(msg) != 3 || string(msg[0]) != `"EVENT"` {
		t.Fatalf("expected matching event: %s", msg)
	}
	if err := json.Unmarshal(msg[2], &got); err != nil {
		t.Fatal(err)
	}
	if got.ID != match.ID {
		t.Fatal("live search broadcast a non-matching event")
	}
	absent := fixture(t, key, 5129, now, nostr.Tags{{"title", "Future arrival"}}, "")
	marker := fixture(t, key, 5, now, nostr.Tags{{"e", absent.ID.Hex()}}, "")
	publish(t, publisher, marker, true)
	publish(t, publisher, absent, false)
	eraseMarker := fixture(t, key, 5, now, nostr.Tags{{"e", marker.ID.Hex()}}, "")
	publish(t, publisher, eraseMarker, false)
	publish(t, publisher, absent, false)
	expiredMarker := fixture(t, key, 5, now, nostr.Tags{{"e", noMatch.ID.Hex()}, {"expiration", fmt.Sprint(now + 60)}}, "")
	publish(t, publisher, expiredMarker, false)
}

func TestServiceIngressKeepsPublicBudgetAndRejectsBrowsers(t *testing.T) {
	relay := newRelay(testStore(t))
	public := httptest.NewServer(relay)
	defer public.Close()
	service := httptest.NewServer(serviceRelayHandler(relay))
	defer service.Close()
	request, _ := http.NewRequest("GET", service.URL, nil)
	request.Header.Set("Origin", "http://127.0.0.1")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusForbidden {
		t.Fatal("browser reached service ingress")
	}
	normal, internal := socket(t, public.URL), socket(t, service.URL)
	subscriber := socket(t, public.URL)
	subscriber.WriteJSON([]any{"REQ", "signal", nostr.Filter{Kinds: []nostr.Kind{25050}, LimitZero: true}})
	if string(read(t, subscriber)[0]) != `"EOSE"` {
		t.Fatal("expected EOSE")
	}
	key := nostr.Generate()
	for i := 0; i < 121; i++ {
		event := fixture(t, key, 25050, nostr.Now(), nostr.Tags{}, fmt.Sprint(i))
		publish(t, normal, event, i < 120)
		if i < 120 {
			read(t, subscriber)
		}
		event = fixture(t, key, 25050, nostr.Now(), nostr.Tags{}, fmt.Sprint("service", i))
		publish(t, internal, event, true)
		read(t, subscriber)
	}
}
