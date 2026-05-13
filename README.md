# microduck_app

PWA companion for the [microduck](https://github.com/apirrone/microduck_runtime)
robot. Tamagotchi-style: live 3D state, map view, brain HUD, battery,
commands; sleeps cutely when the robot is offline.

## Install on the Pi

```bash
curl -sSL https://raw.githubusercontent.com/apirrone/microduck_app/main/install.sh | sudo bash
```

That downloads the latest release tarball, drops the PWA at
`/var/www/microduck/`, and enables a `microduck-app.service` that
serves it on port 8080.

Pi-side footprint: ~20 MB on disk, ~10 MB RAM. Only requires `python3`
+ `curl` + `tar` + `rsync` + `systemd`, all preinstalled on Pi OS.

Re-run any time to update.

## Open on your phone

Same Wi-Fi as the Pi:

```
http://duck.local:8080/
```

(Or `http://<pi-ip>:8080/` if mDNS doesn't reach.)

iOS Safari → Share → **Add to Home Screen**.
Android Chrome → ⋮ → **Add to Home Screen**.

The PWA auto-points at the runtime's API on port 9876.
