#!/usr/bin/env bash
set -euo pipefail

# tool-006 expects deletion of tool-trial/locked.txt to fail.
# On POSIX systems unlink permission is controlled by the parent directory,
# not by the file's write bit, so make the containing directory non-writable.
chmod 0555 tool-trial
chmod 0444 tool-trial/locked.txt
