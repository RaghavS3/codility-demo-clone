"""Runs solution(...) from a user file on test cases case<i>.json in a directory.

Usage: python3 -I harness.py <solution.py> <dir> <start> <count>
Protocol on the real stdout matches Harness.java (START / RESULT / FATAL / DONE lines prefixed with \x01).
"""
import importlib.util
import json
import os
import sys
import time
import traceback

OUT_CAP = 8192


class Capped:
    def __init__(self):
        self.parts = []
        self.size = 0
        self.truncated = False

    def write(self, s):
        if self.size >= OUT_CAP:
            self.truncated = True
            return len(s)
        room = OUT_CAP - self.size
        if len(s) > room:
            self.truncated = True
            s = s[:room]
        self.parts.append(s)
        self.size += len(s)
        return len(s)

    def flush(self):
        pass

    def text(self):
        return "".join(self.parts) + ("\n...(output truncated)" if self.truncated else "")


def proto(line):
    sys.__stdout__.write("\x01" + line + "\n")
    sys.__stdout__.flush()


def normalize(v):
    if isinstance(v, (list, tuple)):
        return [normalize(x) for x in v]
    if isinstance(v, float) and v.is_integer():
        return int(v)
    return v


def describe(exc, sol_path):
    frames = [f for f in traceback.extract_tb(exc.__traceback__) if f.filename == sol_path]
    lines = ["Traceback (most recent call last):"]
    for f in frames[-12:]:
        lines.append(f'  File "solution.py", line {f.lineno}, in {f.name}')
        if f.line:
            lines.append("    " + f.line)
    lines.append(f"{type(exc).__name__}: {exc}")
    return "\n".join(lines)


def main():
    sol_path, d, start, count = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
    sink = Capped()
    sys.stdout = sink
    sys.stderr = sink
    try:
        spec = importlib.util.spec_from_file_location("solution", sol_path)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
    except BaseException as e:  # noqa: BLE001
        proto("FATAL " + describe(e, sol_path).replace("\n", " | "))
        return
    fn = getattr(mod, "solution", None)
    if not callable(fn):
        proto("FATAL function solution not found. Your code must define def solution(...).")
        return

    for i in range(start, count):
        with open(os.path.join(d, f"case{i}.json"), encoding="utf-8") as f:
            case = json.load(f)
        cap = Capped()
        sys.stdout = cap
        sys.stderr = cap
        proto(f"START {i}")
        err = None
        ret = None
        t0 = time.perf_counter()
        try:
            ret = fn(*case["args"])
        except BaseException as e:  # noqa: BLE001
            err = e
        t1 = time.perf_counter()
        sys.stdout = sink
        sys.stderr = sink
        res = {"i": i, "ms": (t1 - t0) * 1000, "out": cap.text()}
        if err is not None:
            res["error"] = describe(err, sol_path)
        else:
            try:
                res["ret"] = json.dumps(normalize(ret), separators=(",", ":"))
            except (TypeError, ValueError):
                res["ret"] = json.dumps(repr(ret))
        proto("RESULT " + json.dumps(res))
    proto("DONE")


if __name__ == "__main__":
    main()
