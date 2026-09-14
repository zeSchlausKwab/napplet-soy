package main

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"fiatjaf.com/nostr/khatru"
)

func TestRelayAliasesPreservePaths(t *testing.T) {
	relay := khatru.NewRelay()
	relay.ServiceURL = "https://relay.napplet.example"
	handler, err := relayRoutes(relay, "127.0.0.1:19347", "https://napplet.example/relay")
	if err != nil {
		t.Fatal(err)
	}
	for _, origin := range []string{"https://relay.napplet.example/", "https://napplet.example/relay", "https://napplet.example/relay/", "http://127.0.0.1:19347/", "http://127.0.0.1:19347/relay"} {
		request := httptest.NewRequest(http.MethodGet, origin, nil)
		request.Header.Set("Accept", "application/nostr+json")
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != 200 || response.Header().Get("Content-Type") != "application/nostr+json" {
			t.Fatalf("alias %s: %d %s", origin, response.Code, response.Body.String())
		}
	}
	request := httptest.NewRequest(http.MethodGet, "https://unconfigured.example/relay", nil)
	request.Header.Set("Accept", "application/nostr+json")
	request.Header.Set("X-Forwarded-Host", "napplet.example")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code == 200 {
		t.Fatal("forwarded headers enabled an unconfigured relay path")
	}
	if _, err := relayRoutes(relay, "127.0.0.1:19347", "https://user:secret@example.com/relay"); err == nil {
		t.Fatal("credential-bearing alias accepted")
	}
}
