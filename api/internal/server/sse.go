package server

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"
)

type Broker struct {
	mu   sync.Mutex
	subs map[string]map[chan []byte]struct{}
}

func newBroker() *Broker {
	return &Broker{subs: map[string]map[chan []byte]struct{}{}}
}

func (b *Broker) Subscribe(monitorID string) (<-chan []byte, func()) {
	ch := make(chan []byte, 16)
	b.mu.Lock()
	if b.subs[monitorID] == nil {
		b.subs[monitorID] = map[chan []byte]struct{}{}
	}
	b.subs[monitorID][ch] = struct{}{}
	b.mu.Unlock()
	return ch, func() {
		b.mu.Lock()
		delete(b.subs[monitorID], ch)
		b.mu.Unlock()
	}
}

func (b *Broker) Publish(monitorID, event string, payload any) {
	raw, err := json.Marshal(payload)
	if err != nil {
		return
	}
	msg := []byte("event: " + event + "\ndata: " + string(raw) + "\n\n")
	b.mu.Lock()
	defer b.mu.Unlock()
	for ch := range b.subs[monitorID] {
		select {
		case ch <- msg:
		default:
		}
	}
}

type Waker struct {
	mu   sync.Mutex
	wait map[string][]chan struct{}
}

func newWaker() *Waker {
	return &Waker{wait: map[string][]chan struct{}{}}
}

func (w *Waker) Wait(id string, timeout time.Duration, ctx context.Context) {
	if timeout < 0 {
		timeout = 0
	}
	ch := make(chan struct{}, 1)
	w.mu.Lock()
	w.wait[id] = append(w.wait[id], ch)
	w.mu.Unlock()
	defer w.remove(id, ch)
	timer := time.NewTimer(timeout)
	defer timer.Stop()
	select {
	case <-ch:
	case <-timer.C:
	case <-ctx.Done():
	}
}

func (w *Waker) remove(id string, ch chan struct{}) {
	w.mu.Lock()
	defer w.mu.Unlock()
	slots := w.wait[id]
	kept := slots[:0]
	for _, slot := range slots {
		if slot != ch {
			kept = append(kept, slot)
		}
	}
	if len(kept) == 0 {
		delete(w.wait, id)
		return
	}
	w.wait[id] = kept
}

func (w *Waker) Notify(id string) {
	w.mu.Lock()
	slots := append([]chan struct{}(nil), w.wait[id]...)
	w.mu.Unlock()
	for _, ch := range slots {
		select {
		case ch <- struct{}{}:
		default:
		}
	}
}

func (s *Server) stream(w http.ResponseWriter, r *http.Request) {
	u, err := s.userFromRequest(r)
	if err != nil {
		writeErr(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	monitorID := r.URL.Query().Get("monitor_id")
	if err := s.monitorVisible(r.Context(), monitorID, u); err != nil {
		writeAPIError(w, err)
		return
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeErr(w, http.StatusInternalServerError, "stream unsupported")
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	ch, cancel := s.broker.Subscribe(monitorID)
	defer cancel()
	fmt.Fprintf(w, ": ok\n\n")
	flusher.Flush()
	ping := time.NewTicker(15 * time.Second)
	defer ping.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case msg := <-ch:
			if _, err := w.Write(msg); err != nil {
				return
			}
			flusher.Flush()
		case <-ping.C:
			if _, err := fmt.Fprintf(w, ": ping\n\n"); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}
