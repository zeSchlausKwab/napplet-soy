package main

import (
	"net"
	"sync"
)

// http.Server.Shutdown does not close hijacked WebSockets. Track accepted sockets
// so shutdown can close them too, before releasing the database handles.
type trackedListener struct {
	net.Listener
	mu          sync.Mutex
	connections map[*trackedConnection]struct{}
	closing     bool
}
type trackedConnection struct {
	net.Conn
	owner *trackedListener
	once  sync.Once
}

func (l *trackedListener) Accept() (net.Conn, error) {
	conn, err := l.Listener.Accept()
	if err != nil {
		return nil, err
	}
	c := &trackedConnection{Conn: conn, owner: l}
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.closing {
		conn.Close()
		return nil, net.ErrClosed
	}
	l.connections[c] = struct{}{}
	return c, nil
}
func (c *trackedConnection) Close() error {
	var err error
	c.once.Do(func() { err = c.Conn.Close(); c.owner.mu.Lock(); delete(c.owner.connections, c); c.owner.mu.Unlock() })
	return err
}
func (l *trackedListener) closeConnections() {
	l.mu.Lock()
	l.closing = true
	connections := make([]*trackedConnection, 0, len(l.connections))
	for c := range l.connections {
		connections = append(connections, c)
	}
	l.mu.Unlock()
	for _, c := range connections {
		c.Close()
	}
}
