package db

import (
	"context"
	_ "embed"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed schema.sql
var schemaSQL string

//go:embed migrate2.sql
var migrate2SQL string

//go:embed migrate3.sql
var migrate3SQL string

//go:embed migrate4.sql
var migrate4SQL string

//go:embed migrate5.sql
var migrate5SQL string

//go:embed migrate6.sql
var migrate6SQL string

//go:embed migrate7.sql
var migrate7SQL string

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
	var speedCols int
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM schema_migrations WHERE version = 2`).Scan(&speedCols); err != nil {
		return err
	}
	if speedCols == 0 {
		if _, err := tx.Exec(ctx, migrate2SQL); err != nil {
			return fmt.Errorf("migrate v2: %w", err)
		}
	}
	var ruleCols int
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM schema_migrations WHERE version = 3`).Scan(&ruleCols); err != nil {
		return err
	}
	if ruleCols == 0 {
		if _, err := tx.Exec(ctx, migrate3SQL); err != nil {
			return fmt.Errorf("migrate v3: %w", err)
		}
	}
	var refreshCols int
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM schema_migrations WHERE version = 4`).Scan(&refreshCols); err != nil {
		return err
	}
	if refreshCols == 0 {
		if _, err := tx.Exec(ctx, migrate4SQL); err != nil {
			return fmt.Errorf("migrate v4: %w", err)
		}
	}
	var updateCols int
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM schema_migrations WHERE version = 5`).Scan(&updateCols); err != nil {
		return err
	}
	if updateCols == 0 {
		if _, err := tx.Exec(ctx, migrate5SQL); err != nil {
			return fmt.Errorf("migrate v5: %w", err)
		}
	}
	var v6 int
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM schema_migrations WHERE version = 6`).Scan(&v6); err != nil {
		return err
	}
	if v6 == 0 {
		if _, err := tx.Exec(ctx, migrate6SQL); err != nil {
			return fmt.Errorf("migrate v6: %w", err)
		}
	}
	var v7 int
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM schema_migrations WHERE version = 7`).Scan(&v7); err != nil {
		return err
	}
	if v7 == 0 {
		if _, err := tx.Exec(ctx, migrate7SQL); err != nil {
			return fmt.Errorf("migrate v7: %w", err)
		}
	}
	return tx.Commit(ctx)
}
