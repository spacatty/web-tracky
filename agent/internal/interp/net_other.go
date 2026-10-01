//go:build !linux

package interp

func kernelVersion() string { return "" }

func sampleNet(e *Engine) (any, error) {
	return map[string]any{
		"adapter":        "",
		"rx_bps":         0.0,
		"tx_bps":         0.0,
		"link_speed_bps": 0.0,
	}, nil
}
