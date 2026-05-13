# microduck_app

PWA companion for the microduck robot. Tamagotchi-style: live 3D
state, map view, brain HUD; sleeps cutely when the robot is offline.

## Stack
- SolidJS + Vite + Tailwind, three.js for the 3D viewer
- PWA via `vite-plugin-pwa` (offline shell + service worker)
- Backend-agnostic: same JSON shape served by
  - `microduck_brain` sim (`sim/web_server.py`)
  - `microduck_runtime` Pi (`maploc_web.rs`)

## Run

### Sim (laptop, one process)

```bash
# terminal 1
cd ~/MISC/microduck_brain && uv run scripts/run_sim.py --ducks 1

# terminal 2
cd ~/MISC/microduck_app && npm install && npm run dev
```

Open `http://localhost:5173`. From your phone on the same Wi-Fi: replace
`localhost` with your laptop's IP.

### Real robot

The runtime serves `/state.json`, `/map.pgm`, `/goal`, `/command` on
port 9876. To get the PWA to your phone, install it on the Pi itself.

#### Install on the Pi

```bash
# From your laptop, after building:
cd ~/MISC/microduck_app
DUCK_HOST=pi@duck.local npm run deploy
```

That `rsync`s the built bundle + systemd unit to the Pi and runs the
installer. It enables `microduck-app.service` to serve `dist/` on
**port 8080** under `python3 -m http.server`.

Then on any phone / tablet on the same Wi-Fi:

```
http://duck.local:8080/
```

iOS Safari → Share → **Add to Home Screen**.
Android Chrome → ⋮ → **Add to Home Screen**.

You'll get a launcher icon that opens fullscreen, no browser chrome.

#### Updating

`npm run deploy` again. Service restarts automatically. Service worker
fetches the new bundle on next launch.

#### Manual install (without npm)

If you just want to install from a GitHub release on the Pi:

```bash
curl -sSL https://github.com/apirrone/microduck_app/releases/latest/download/microduck-app.tar.gz \
  | sudo tar -xz -C /tmp/microduck_app/
sudo bash /tmp/microduck_app/deploy/install.sh --local
```

Tag a release with `git tag vX.Y && git push --tags`; the GitHub Action
in `.github/workflows/release.yml` builds and publishes the tarball.

## Layout

```
public/robot/                kinematics.json + STL meshes (built by scripts/)
scripts/build_kinematics.py  MJCF → kinematics.json + copies STLs
src/components/              DuckViewer, MapView, BrainHUD, SettingsSheet, BatteryPill
src/duck/                    three.js rig builder + sleep pose
src/state/                   connection + telemetry types
deploy/                      systemd unit + install.sh for the Pi
```
