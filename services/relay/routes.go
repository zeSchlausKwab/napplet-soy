package main

import (
	"fmt"
	"net/http"
	"net/url"
	"strings"

	"fiatjaf.com/nostr/khatru"
)

// Each public alias must be configured by the operator. Neither Host nor
// Forwarded can invent a new NIP-42 authentication URL.
func relayRoutes(relay *khatru.Relay, direct, aliases string) (http.Handler, error) {
	routes := make(map[string]http.Handler)
	for _, value := range append([]string{relay.ServiceURL, "http://" + direct, "http://" + direct + "/relay"}, strings.Split(aliases, ",")...) {
		if value == "" {
			continue
		}
		u, err := url.Parse(value)
		if err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
			return nil, fmt.Errorf("invalid configured relay alias")
		}
		routes[u.Host+"\x00"+strings.TrimSuffix(u.Path, "/")] = relay.WithServiceURL(value)
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if handler, ok := routes[r.Host+"\x00"+strings.TrimSuffix(r.URL.Path, "/")]; ok {
			handler.ServeHTTP(w, r)
		} else {
			// Preserve the internal health router; fallback retains the canonical URL.
			relay.ServeHTTP(w, r)
		}
	}), nil
}
