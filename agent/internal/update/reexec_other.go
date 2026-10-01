//go:build !unix

package update

import "fmt"

func reexec(exe string) error {
	return fmt.Errorf("self-update restart is only supported on unix (%s)", exe)
}
