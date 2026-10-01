package db

import (
	"context"
	_ "embed"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed schema.sql
var schemaSQL string

func Connect(ctx context.Context, url string) (*pgxpool.Pool, error) {
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		return nil, err
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, err
	}
	return pool, nil
}

func Migrate(ctx context.Context, pool *pgxpool.Pool) error {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var reg *string
	if err := tx.QueryRow(ctx, `SELECT to_regclass('public.schema_migrations')::text`).Scan(&reg); err != nil {
		return err
	}
	applied := false
	if reg != nil {
		var n int
		if err := tx.QueryRow(ctx, `SELECT count(*) FROM schema_migrations WHERE version = 1`).Scan(&n); err != nil {
			return err
		}
		applied = n > 0
	}
	if !applied {
		if _, err := tx.Exec(ctx, schemaSQL); err != nil {
			return fmt.Errorf("migrate: %w", err)
		}
	}
	return tx.Commit(ctx)
}
