#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""把 src/ 下的 CSS/JS 内联进 shell.html，产出单文件 index.html。

为什么要打成单文件：
  1. 双击即可运行，不依赖任何服务器或网络；
  2. 发给客户/同事时只有一个文件，不会出现「样式丢了」；
  3. 内联后不存在跨域与相对路径问题。

用法：python build.py
"""
import os
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "src")
SHARED = os.path.join(os.path.dirname(HERE), "shared")
OUT = os.path.join(HERE, "index.html")


def read(name):
    with open(os.path.join(SRC, name), encoding="utf-8") as f:
        return f.read()


def read_shared(name):
    """前后端共用文件（如任职要求素材库）——后端 require 同一份，避免两处维护走偏。"""
    with open(os.path.join(SHARED, name), encoding="utf-8") as f:
        return f.read()


def main():
    shell = read("shell.html")
    shell = shell.replace("__CSS__", read("app.css"))
    # req-lib 必须最先注入：data.js / agent.js 都要用 window.ReqLib
    shell = shell.replace("__REQLIB__", read_shared("req-lib.js"))
    shell = shell.replace("__DATA__", read("data.js"))
    shell = shell.replace("__AGENT__", read("agent.js"))
    shell = shell.replace("__APP__", read("app.js"))
    shell = shell.replace("__BUILT__", datetime.now(timezone(timedelta(hours=8))).strftime("%Y-%m-%d %H:%M"))
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(shell)
    print(f"OK -> {OUT} ({len(shell):,} chars)")


if __name__ == "__main__":
    main()
