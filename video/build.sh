#!/bin/bash
# build.sh — assembles the final demo video from slides, narration and the
# recorded adk-web demo. Output: video/build/pii-firewall-demo.mp4
set -euo pipefail
cd "$(dirname "$0")/build"

DEMO_WEBM=$(ls page@*.webm | head -1)
FPS=30

dur() { ffprobe -v error -show_entries format=duration -of csv=p=0 "$1"; }

D1=$(dur audio/seg1.mp3); D2=$(dur audio/seg2.mp3); D3=$(dur audio/seg3.mp3)
D4=$(dur audio/seg4.mp3); D5=$(dur audio/seg5.mp3); D6=$(dur audio/seg6.mp3)
echo "narration: $D1 $D2 $D3 $D4 $D5 $D6"

# Give each segment a small tail after the narration ends
pad() { python3 -c "print(f'{float('$1')+1.2:.3f}')"; }

# --- seg1: title (40%) + problem (60%) over narration 1 ---
T1=$(pad "$D1")
T1a=$(python3 -c "print(f'{float('$T1')*0.4:.3f}')")
T1b=$(python3 -c "print(f'{float('$T1')-float('$T1a'):.3f}')")
ffmpeg -y -v error -loop 1 -t "$T1a" -i slide1.png -loop 1 -t "$T1b" -i slide2.png \
  -i audio/seg1.mp3 \
  -filter_complex "[0:v][1:v]concat=n=2:v=1:a=0,fps=${FPS},format=yuv420p[v]" \
  -map "[v]" -map 2:a -c:v libx264 -c:a aac -shortest seg1.mp4

# --- seg2: architecture slide ---
ffmpeg -y -v error -loop 1 -t "$(pad "$D2")" -i slide3.png -i audio/seg2.mp3 \
  -vf "fps=${FPS},format=yuv420p" -c:v libx264 -c:a aac -shortest seg2.mp4

# --- seg3: demo recording sped up to fit narration 3 ---
DW=$(dur "$DEMO_WEBM")
T3=$(pad "$D3")
SPEED=$(python3 -c "print(f'{float('$DW')/float('$T3'):.5f}')")
echo "demo ${DW}s -> ${T3}s (speed ${SPEED}x)"
ffmpeg -y -v error -i "$DEMO_WEBM" -i audio/seg3.mp3 \
  -filter_complex "[0:v]setpts=PTS/${SPEED},fps=${FPS},scale=1920:1080,format=yuv420p[v]" \
  -map "[v]" -map 1:a -c:v libx264 -c:a aac -shortest seg3.mp4

# --- seg4: proof screen ---
ffmpeg -y -v error -loop 1 -t "$(pad "$D4")" -i proof.png -i audio/seg4.mp3 \
  -vf "fps=${FPS},format=yuv420p" -c:v libx264 -c:a aac -shortest seg4.mp4

# --- seg5: security slide ---
ffmpeg -y -v error -loop 1 -t "$(pad "$D5")" -i slide4.png -i audio/seg5.mp3 \
  -vf "fps=${FPS},format=yuv420p" -c:v libx264 -c:a aac -shortest seg5.mp4

# --- seg6: build slide (+ antigravity screenshot if present) ---
if [[ -f antigravity.png ]]; then
  T6=$(pad "$D6")
  T6a=$(python3 -c "print(f'{float('$T6')*0.55:.3f}')")
  T6b=$(python3 -c "print(f'{float('$T6')-float('$T6a'):.3f}')")
  ffmpeg -y -v error -loop 1 -t "$T6a" -i slide5.png -loop 1 -t "$T6b" -i antigravity.png \
    -i audio/seg6.mp3 \
    -filter_complex "[1:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0x0f1419[a1];[0:v][a1]concat=n=2:v=1:a=0,fps=${FPS},format=yuv420p[v]" \
    -map "[v]" -map 2:a -c:v libx264 -c:a aac -shortest seg6.mp4
else
  ffmpeg -y -v error -loop 1 -t "$(pad "$D6")" -i slide5.png -i audio/seg6.mp3 \
    -vf "fps=${FPS},format=yuv420p" -c:v libx264 -c:a aac -shortest seg6.mp4
fi

# --- concat ---
printf "file 'seg%d.mp4'\n" 1 2 3 4 5 6 > list.txt
ffmpeg -y -v error -f concat -safe 0 -i list.txt -c copy pii-firewall-demo.mp4
echo "final: $(dur pii-firewall-demo.mp4)s"
ls -la pii-firewall-demo.mp4
