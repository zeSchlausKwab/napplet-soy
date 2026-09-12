package main

import (
	"context"
	"sync"
	"time"

	"fiatjaf.com/nostr/khatru"
)

type connectionBudget struct {
	minute           int64
	requests, events int
}
type connectionBudgets struct {
	sync.Mutex
	values map[*khatru.WebSocket]*connectionBudget
}

func (b *connectionBudgets) allow(ctx context.Context, publish bool) bool {
	ws := khatru.GetConnection(ctx)
	if ws == nil {
		return true
	}
	b.Lock()
	defer b.Unlock()
	minute := time.Now().Unix() / 60
	q := b.values[ws]
	if q == nil {
		return false
	}
	if q.minute != minute {
		q = &connectionBudget{minute: minute}
		b.values[ws] = q
	}
	if publish {
		q.events++
		return q.events <= 120
	}
	q.requests++
	return q.requests <= 240
}
func (b *connectionBudgets) forget(ctx context.Context) {
	b.Lock()
	defer b.Unlock()
	delete(b.values, khatru.GetConnection(ctx))
}

func (b *connectionBudgets) connect(ctx context.Context) {
	b.Lock()
	defer b.Unlock()
	b.values[khatru.GetConnection(ctx)] = &connectionBudget{minute: time.Now().Unix() / 60}
}
