package main

import (
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"

	"tracky/agent/internal/config"
)

const (
	serviceName = "tracky-agent"
	unitPath    = "/etc/systemd/system/tracky-agent.service"
	installPath = "/usr/local/bin/tracky-agent"
)

// decommission runs after the panel deleted this node. It removes the enrollment
// so a restart cannot heartbeat again, then tears down the systemd unit the
// installer created. Stop is queued with --no-block because it terminates us.
func (a *app) decommission() {
	log.Printf("node was removed from the panel, uninstalling")
	if err := os.Remove(a.cfgPath); err != nil && !os.IsNotExist(err) {
		log.Printf("remove config: %v", err)
	}
	if err := os.RemoveAll(config.StateDir(a.cfgPath)); err != nil {
		log.Printf("remove state: %v", err)
	}
	if runtime.GOOS != "linux" {
		os.Exit(0)
	}
	_ = os.Remove(filepath.Dir(a.cfgPath))
	if exe, err := os.Executable(); err == nil {
		if resolved, err := filepath.EvalSymlinks(exe); err == nil {
			exe = resolved
		}
		if exe == installPath {
			if err := os.Remove(exe); err != nil {
				log.Printf("remove binary: %v", err)
			}
		}
	}
	if _, err := exec.LookPath("systemctl"); err != nil {
		os.Exit(0)
	}
	run("systemctl", "disable", serviceName)
	if err := os.Remove(unitPath); err != nil && !os.IsNotExist(err) {
		log.Printf("remove unit: %v", err)
	}
	run("systemctl", "daemon-reload")
	run("systemctl", "stop", "--no-block", serviceName)
	os.Exit(0)
}

func run(name string, args ...string) {
	if out, err := exec.Command(name, args...).CombinedOutput(); err != nil {
		log.Printf("%s %v: %v %s", name, args, err, out)
	}
}
