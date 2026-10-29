#!/usr/bin/env bash
set -euo pipefail
script_dir="$(cd "$(dirname "$0")" && pwd)"
args_file="$script_dir/args.txt"
printf "%s\n" "$@" > "$args_file"
previous_arg=""
last_arg=""
for arg in "$@"; do previous_arg="$last_arg"; last_arg="$arg"; done
if [[ "$last_arg" = -* && "$previous_arg" != "--" ]]; then
    echo "leading-dash operand was parsed as an option" >&2
    exit 64
fi
output_template=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        --output) output_template="$2"; shift 2 ;;
        --js-runtimes|--remote-components|--cookies|--sub-langs|--sub-format) shift 2 ;;
        --) shift ;;
        *) shift ;;
    esac
done
if [[ -z "$output_template" ]]; then echo "missing output template" >&2; exit 1; fi
output_path="${output_template//%(id)s/fixture-video}"
output_path="${output_path//%(ext)s/vtt}"
mkdir -p "$(dirname "$output_path")"
cat > "$output_path" <<'EOF'
WEBVTT

00:00:01.000 --> 00:00:02.000
Fictional transcript fixture
EOF
