#!/bin/bash
cd "$(dirname "$0")"
APP="./墨枢.app"
if [ ! -d "$APP" ]; then
  APP=$(find . -maxdepth 2 -name "*.app" | head -n 1)
fi
if [ -z "$APP" ] || [ ! -d "$APP" ]; then
  echo "未找到墨枢.app，请确认解压完整。"
  read -r _
  exit 1
fi
open "$APP"
