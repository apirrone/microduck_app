#!/usr/bin/env bash
# Microduck PWA installer — runs on the Raspberry Pi.
#
# Pulls the latest release tarball from GitHub, drops the built PWA at
# /var/www/microduck/, installs a tiny systemd service that serves it
# on port 8080. The runtime serves the API on 9876; the PWA fetches
# cross-origin (the runtime allows it).
#
# Usage:
#   curl -sSL https://raw.githubusercontent.com/apirrone/microduck_app/main/install.sh | sudo bash
#
# Re-run any time to update. Idempotent.

set -euo pipefail

REPO="apirrone/microduck_app"
WWW_DIR="/var/www/microduck"
SERVICE_NAME="microduck-app.service"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}"

bold()   { printf '\033[1m%s\033[0m\n' "$*"; }
say()    { printf '  %s\n' "$*"; }
die()    { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "run as root (use sudo)"
command -v curl    >/dev/null || die "curl is required"
command -v tar     >/dev/null || die "tar is required"
command -v python3 >/dev/null || die "python3 is required (used as the static-file server)"

bold "📦 Microduck PWA installer"

tmp="$(mktemp -d)"
trap "rm -rf ${tmp}" EXIT

say "fetching latest release from github.com/${REPO}…"
tarball="${tmp}/app.tar.gz"
if ! curl -fsSL --retry 3 \
        "https://github.com/${REPO}/releases/latest/download/microduck-app.tar.gz" \
        -o "${tarball}"; then
  die "no release tarball found. Tag a release first (\`git tag vX.Y && git push --tags\`)."
fi

say "extracting…"
tar -xzf "${tarball}" -C "${tmp}"
[[ -f "${tmp}/dist/index.html" ]] || die "release tarball missing dist/index.html"
[[ -f "${tmp}/deploy/microduck-app.service" ]] || die "release tarball missing systemd unit"

say "installing PWA → ${WWW_DIR}"
mkdir -p "${WWW_DIR}"
rsync -a --delete "${tmp}/dist/" "${WWW_DIR}/"
chown -R nobody:nogroup "${WWW_DIR}"

say "installing systemd unit"
install -m 0644 "${tmp}/deploy/microduck-app.service" "${SERVICE_FILE}"
systemctl daemon-reload
systemctl enable --now "${SERVICE_NAME}"

sleep 1
systemctl is-active --quiet "${SERVICE_NAME}" \
  || die "${SERVICE_NAME} failed to start. Logs: journalctl -u ${SERVICE_NAME} -n 50"

ip="$(hostname -I | awk '{print $1}')"
host="$(hostname).local"
echo
bold "✓ Microduck PWA running"
say "open  →  http://${ip}:8080/"
say "       or http://${host}:8080/  (via mDNS)"
say "logs  →  journalctl -u ${SERVICE_NAME} -f"
