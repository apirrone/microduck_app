#!/usr/bin/env python3
"""Parse each vendored microduck MJCF, emit runtime-friendly kinematics
JSONs, and copy referenced STL meshes.

We ship two robot variants (v1 and v1.5). For each, the script writes:
    public/robot/<variant>/kinematics.json
    public/robot/<variant>/meshes/*.stl

The PWA's three.js viewer chooses one at runtime based on the
`robot_version` field broadcast by the runtime in `/state.json`.

To refresh from upstream:
    cd ~/MISC/mjlab_microduck && git checkout main
    cp src/mjlab_microduck/robot/microduck/robot_walk.xml \\
       ~/MISC/microduck_app/robot_assets/v1/
    cp src/mjlab_microduck/robot/microduck/assets/*.stl \\
       ~/MISC/microduck_app/robot_assets/v1/assets/
    git checkout v1.5_new_cmd_obs
    # … same into robot_assets/v1.5/

Run: python3 scripts/build_kinematics.py
"""

from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path
from xml.etree import ElementTree as ET

ROOT = Path(__file__).resolve().parent.parent
VARIANTS_DIR = ROOT / "robot_assets"
OUT_DIR = ROOT / "public" / "robot"

# Variants discovered as immediate subdirectories of `robot_assets/`. The
# subdirectory name (e.g. "v1", "v1.5") becomes the URL path segment
# (`/robot/<variant>/`) the PWA fetches.
def discover_variants() -> list[str]:
    return sorted(p.name for p in VARIANTS_DIR.iterdir()
                  if p.is_dir() and (p / "robot_walk.xml").is_file())


def parse_floats(s: str | None) -> list[float]:
    if not s:
        return []
    return [float(x) for x in s.replace(",", " ").split()]


def parse_pos(s: str | None) -> list[float]:
    v = parse_floats(s)
    return v if len(v) == 3 else [0.0, 0.0, 0.0]


def parse_quat(s: str | None) -> list[float]:
    v = parse_floats(s)
    return v if len(v) == 4 else [1.0, 0.0, 0.0, 0.0]


def parse_color(s: str | None) -> list[float] | None:
    v = parse_floats(s)
    return v if len(v) == 4 else None


def build_variant(variant: str) -> bool:
    mjcf_dir = VARIANTS_DIR / variant
    mjcf_file = mjcf_dir / "robot_walk.xml"
    asset_dir = mjcf_dir / "assets"
    out_dir = OUT_DIR / variant
    out_mesh_dir = out_dir / "meshes"
    out_json = out_dir / "kinematics.json"
    mesh_url_prefix = f"/robot/{variant}/meshes"

    if not mjcf_file.is_file():
        print(f"  [{variant}] MJCF not found: {mjcf_file}", file=sys.stderr)
        return False

    tree = ET.parse(mjcf_file)
    root = tree.getroot()

    materials: dict[str, list[float]] = {}
    for asset in root.iter("asset"):
        for mat in asset.findall("material"):
            name = mat.get("name")
            rgba = parse_color(mat.get("rgba"))
            if name and rgba:
                materials[name] = rgba

    mesh_files: dict[str, Path] = {}
    for asset in root.iter("asset"):
        for m in asset.findall("mesh"):
            file = m.get("file")
            if not file:
                continue
            base = (m.get("name") or Path(file).stem).strip()
            mesh_files[base] = asset_dir / file

    actuated: list[str] = []
    for act in root.iter("actuator"):
        for el in act:
            j = el.get("joint")
            if j:
                actuated.append(j)

    bodies: list[dict] = []

    def visit(elem: ET.Element, parent: str | None) -> None:
        for body in elem.findall("body"):
            name = body.get("name") or f"body_{len(bodies)}"
            entry: dict = {
                "name": name,
                "parent": parent,
                "pos": parse_pos(body.get("pos")),
                "quat": parse_quat(body.get("quat")),
                "geoms": [],
            }
            joint = body.find("joint")
            if joint is not None:
                jname = joint.get("name") or f"{name}_joint"
                axis = parse_floats(joint.get("axis")) or [0, 0, 1]
                jrange = parse_floats(joint.get("range")) or None
                jentry: dict = {
                    "name": jname,
                    "axis": axis,
                    "type": joint.get("type") or "hinge",
                    "pos": parse_pos(joint.get("pos") or "0 0 0"),
                }
                if jrange and len(jrange) == 2:
                    jentry["range"] = jrange
                if jname in actuated:
                    jentry["actuator_index"] = actuated.index(jname)
                entry["joint"] = jentry
            for geom in body.findall("geom"):
                if geom.get("group") == "3":
                    continue
                gtype = geom.get("type") or "mesh"
                mesh = geom.get("mesh")
                ge: dict = {"type": gtype}
                if mesh:
                    ge["mesh"] = f"{mesh}.stl"
                if geom.get("pos"):
                    ge["pos"] = parse_pos(geom.get("pos"))
                if geom.get("quat"):
                    ge["quat"] = parse_quat(geom.get("quat"))
                size = parse_floats(geom.get("size"))
                if size:
                    ge["size"] = size
                mat_name = geom.get("material")
                rgba = parse_color(geom.get("rgba"))
                if rgba is None and mat_name and mat_name in materials:
                    rgba = materials[mat_name]
                if rgba:
                    ge["color"] = rgba
                entry["geoms"].append(ge)
            bodies.append(entry)
            visit(body, name)

    worldbody = root.find("worldbody")
    if worldbody is None:
        print(f"  [{variant}] no <worldbody>", file=sys.stderr)
        return False
    visit(worldbody, None)

    out_mesh_dir.mkdir(parents=True, exist_ok=True)
    # Wipe previous meshes so a renamed STL doesn't get served stale.
    for old in out_mesh_dir.glob("*.stl"):
        old.unlink()
    referenced: set[str] = set()
    for b in bodies:
        for g in b["geoms"]:
            m = g.get("mesh")
            if m:
                referenced.add(Path(m).stem)
    copied = 0
    for base in sorted(referenced):
        src = mesh_files.get(base)
        if not src or not src.exists():
            print(f"  [{variant}] warn: missing STL for '{base}' (looked in {src})")
            continue
        shutil.copyfile(src, out_mesh_dir / f"{base}.stl")
        copied += 1

    out = {
        "bodies": bodies,
        "actuated_joints": actuated,
        "mesh_dir": mesh_url_prefix,
    }
    out_json.parent.mkdir(parents=True, exist_ok=True)
    out_json.write_text(json.dumps(out, indent=1))
    print(f"  [{variant}] {len(bodies)} bodies, {len(actuated)} actuators, "
          f"{copied}/{len(referenced)} meshes → {out_dir.relative_to(ROOT)}")
    return True


def main() -> int:
    variants = discover_variants()
    if not variants:
        print(f"error: no variants found under {VARIANTS_DIR}", file=sys.stderr)
        return 1
    ok = 0
    for v in variants:
        if build_variant(v):
            ok += 1
    print(f"built {ok}/{len(variants)} variants")
    return 0 if ok == len(variants) else 1


if __name__ == "__main__":
    raise SystemExit(main())
