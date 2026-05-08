# microduck_app

PWA companion for the microduck robot. Tamagotchi-style: live 3D
state, map view, brain HUD; sleeps cutely when the robot is offline.

## Stack
- SolidJS + Vite + Tailwind, three.js for the 3D viewer
- PWA via `vite-plugin-pwa` (offline shell + service worker)
- Backend-agnostic: the same JSON shape is served by both
  - `microduck_brain` sim (`sim/web_server.py`)
  - `microduck_runtime` Pi (`maploc_web.rs`, with planned joint extension)

## Milestone 1 — sim loop

Two terminals:

```bash
# 1) sim (publishes telemetry on :8080)
cd ~/MISC/microduck_brain
uv run scripts/run_sim.py --ducks 1

# 2) PWA dev server
cd ~/MISC/microduck_app
npm install        # first time only
npm run kinematics # parses MJCF, copies STLs into public/robot
npm run dev        # → http://localhost:5173
```

Open the dev URL on your phone (same Wi-Fi) by replacing `localhost`
with your laptop's LAN IP. Tap the gear icon → set Robot URL to
`http://<laptop-ip>:8080`.

What you should see:
- A live 3D microduck driven by the sim's joint state
- "🦆 Duck" tab: brain HUD (drives + behaviour) when the sim is up
- "🗺️ Map" tab: blank for now (sim has no maploc yet)
- Stop the sim → app drops into 💤 sleeping mode with floating Z's

## Endpoints (sim or robot)
| Method | Path          | Purpose                                       |
|--------|---------------|-----------------------------------------------|
| GET    | /state.json   | Pose + joints + brain bits                    |
| GET    | /map.pgm      | Occupancy grid (real Pi only — sim returns 503)|
| POST   | /goal         | Tap-to-goto target in world frame             |
| POST   | /command      | `{"cmd":"startle"|"quack"|...}`               |

## Layout
```
public/robot/        kinematics.json + STL meshes (built by scripts/)
scripts/build_kinematics.py   MJCF → kinematics.json + copies STLs
src/components/      DuckViewer, MapView, BrainHUD, SettingsSheet
src/duck/            three.js rig builder + sleep pose
src/state/           connection + telemetry types
```
