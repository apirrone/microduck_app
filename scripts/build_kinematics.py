#!/usr/bin/env python3
"""Parse the microduck MJCF, emit a runtime-friendly kinematics JSON, and
copy referenced STL meshes into public/robot/meshes/.

The PWA's three.js viewer consumes the JSON: one body per group, joints
described by axis + range + actuator index. Materials are inlined as
RGBA so the renderer doesn't need the MJCF.

Run: python3 scripts/build_kinematics.py
"""

from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path
from xml.etree import ElementTree as ET

ROOT = Path(__file__).resolve().parent.parent
# Sibling-checkout default; override with $MJCF_DIR_OVERRIDE for CI or
# unusual layouts.
_DEFAULT_MJCF_DIR = (
    Path.home()
    / "MISC"
    / "mjlab_microduck"
    / "src"
    / "mjlab_microduck"
    / "robot"
    / "microduck"
)
import os
MJCF_DIR = Path(os.environ.get("MJCF_DIR_OVERRIDE", _DEFAULT_MJCF_DIR))
MJCF_FILE = MJCF_DIR / "robot_walk.xml"
ASSET_DIR = MJCF_DIR / "assets"

OUT_DIR = ROOT / "public" / "robot"
OUT_MESH_DIR = OUT_DIR / "meshes"
OUT_JSON = OUT_DIR / "kinematics.json"


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


def main() -> int:
    if not MJCF_FILE.exists():
        print(f"error: MJCF not found: {MJCF_FILE}", file=sys.stderr)
        return 1

    tree = ET.parse(MJCF_FILE)
    root = tree.getroot()

    # Materials → name → rgba
    materials: dict[str, list[float]] = {}
    for asset in root.iter("asset"):
        for mat in asset.findall("material"):
            name = mat.get("name")
            rgba = parse_color(mat.get("rgba"))
            if name and rgba:
                materials[name] = rgba

    # Mesh basename → file. MJCF compiler `meshdir="assets"` resolves
    # relative to the XML.
    mesh_files: dict[str, Path] = {}
    for asset in root.iter("asset"):
        for m in asset.findall("mesh"):
            file = m.get("file")
            if not file:
                continue
            base = (m.get("name") or Path(file).stem).strip()
            mesh_files[base] = ASSET_DIR / file

    # Actuator order — array index in the runtime maps to this list.
    actuated: list[str] = []
    for act in root.iter("actuator"):
        for el in act:
            j = el.get("joint")
            if j:
                actuated.append(j)

    # Walk the worldbody recursively. We collect a flat list of bodies
    # with parent name = enclosing <body name="...">.
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
                jentry = {
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
                # Only keep visual mesh geoms (group=2 or no group). Skip
                # collision-only group=3.
                grp = geom.get("group")
                if grp == "3":
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
        print("error: no <worldbody>", file=sys.stderr)
        return 1
    visit(worldbody, None)

    # Copy STLs we actually reference. Materials lookup uses mesh basename
    # (without .stl), so do the same here.
    OUT_MESH_DIR.mkdir(parents=True, exist_ok=True)
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
            print(f"  warn: missing STL for '{base}' (looked in {src})")
            continue
        dst = OUT_MESH_DIR / f"{base}.stl"
        shutil.copyfile(src, dst)
        copied += 1
    print(f"  copied {copied}/{len(referenced)} STL meshes → {OUT_MESH_DIR}")

    out = {
        "bodies": bodies,
        "actuated_joints": actuated,
        "mesh_dir": "/robot/meshes",
    }
    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(json.dumps(out, indent=1))
    print(f"  wrote {OUT_JSON}  ({len(bodies)} bodies, {len(actuated)} actuators)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
