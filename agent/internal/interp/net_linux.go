//go:build linux

package interp

import (
	"os"
	"strconv"
	"strings"
	"time"
)

func kernelVersion() string {
	raw, err := os.ReadFile("/proc/sys/kernel/osrelease")
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(raw))
}

func sampleNet(e *Engine) (any, error) {
	iface := defaultIface()
	rx, tx, err := readCounters(iface)
	if err != nil {
		return map[string]any{"adapter": iface, "rx_bps": 0.0, "tx_bps": 0.0, "link_speed_bps": 0.0}, err
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	var rxBps, txBps float64
	if e.have {
		dt := time.Since(e.lastAt).Seconds()
		if dt > 0 {
			if rx >= e.lastRX {
				rxBps = float64(rx-e.lastRX) / dt
			}
			if tx >= e.lastTX {
				txBps = float64(tx-e.lastTX) / dt
			}
		}
	}
	e.lastRX, e.lastTX, e.lastAt, e.have = rx, tx, time.Now(), true
	return map[string]any{
		"adapter":        iface,
		"rx_bps":         rxBps,
		"tx_bps":         txBps,
		"link_speed_bps": linkSpeed(iface),
	}, nil
}

func defaultIface() string {
	raw, err := os.ReadFile("/proc/net/route")
	if err == nil {
		lines := strings.Split(string(raw), "\n")
		for _, line := range lines[1:] {
			fields := strings.Fields(line)
			if len(fields) >= 2 && fields[1] == "00000000" && fields[0] != "lo" {
				return fields[0]
			}
		}
	}
	counters, _ := parseDev()
	for name := range counters {
		if name != "lo" {
			return name
		}
	}
	return ""
}

func readCounters(iface string) (uint64, uint64, error) {
	counters, err := parseDev()
	if err != nil {
		return 0, 0, err
	}
	if iface == "" {
		var rx, tx uint64
		for name, pair := range counters {
			if name == "lo" {
				continue
			}
			rx += pair[0]
			tx += pair[1]
		}
		return rx, tx, nil
	}
	pair, ok := counters[iface]
	if !ok {
		return 0, 0, nil
	}
	return pair[0], pair[1], nil
}

func parseDev() (map[string][2]uint64, error) {
	raw, err := os.ReadFile("/proc/net/dev")
	if err != nil {
		return nil, err
	}
	out := map[string][2]uint64{}
	for _, line := range strings.Split(string(raw), "\n") {
		if !strings.Contains(line, ":") {
			continue
		}
		parts := strings.SplitN(line, ":", 2)
		name := strings.TrimSpace(parts[0])
		fields := strings.Fields(parts[1])
		if len(fields) < 9 {
			continue
		}
		rx, _ := strconv.ParseUint(fields[0], 10, 64)
		tx, _ := strconv.ParseUint(fields[8], 10, 64)
		out[name] = [2]uint64{rx, tx}
	}
	return out, nil
}

func linkSpeed(iface string) float64 {
	if iface == "" {
		return 0
	}
	raw, err := os.ReadFile("/sys/class/net/" + iface + "/speed")
	if err != nil {
		return 0
	}
	mbps, err := strconv.ParseFloat(strings.TrimSpace(string(raw)), 64)
	if err != nil || mbps <= 0 {
		return 0
	}
	return mbps * 1_000_000
}
