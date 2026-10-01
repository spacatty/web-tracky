package geo

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"time"
)

type Place struct {
	Country     string
	CountryCode string
	City        string
	Latitude    *float64
	Longitude   *float64
}

func Lookup(ctx context.Context, template, ip string) (Place, error) {
	var place Place
	if strings.TrimSpace(template) == "" {
		return place, nil
	}
	parsed := net.ParseIP(ip)
	if parsed == nil || parsed.IsLoopback() || parsed.IsPrivate() || parsed.IsLinkLocalUnicast() || parsed.IsUnspecified() {
		return place, nil
	}
	endpoint := strings.ReplaceAll(template, "{ip}", ip)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return place, err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "tracky-api")
	client := &http.Client{Timeout: 4 * time.Second}
	res, err := client.Do(req)
	if err != nil {
		return place, err
	}
	defer res.Body.Close()
	if res.StatusCode >= 300 {
		return place, fmt.Errorf("geo lookup status %d", res.StatusCode)
	}
	var body struct {
		Success     *bool    `json:"success"`
		Country     string   `json:"country"`
		CountryCode string   `json:"country_code"`
		City        string   `json:"city"`
		Latitude    *float64 `json:"latitude"`
		Longitude   *float64 `json:"longitude"`
	}
	if err := json.NewDecoder(io.LimitReader(res.Body, 1<<20)).Decode(&body); err != nil {
		return place, err
	}
	if body.Success != nil && !*body.Success {
		return place, fmt.Errorf("geo lookup unsuccessful")
	}
	place.Country = body.Country
	place.CountryCode = strings.ToUpper(body.CountryCode)
	place.City = body.City
	place.Latitude = body.Latitude
	place.Longitude = body.Longitude
	return place, nil
}
