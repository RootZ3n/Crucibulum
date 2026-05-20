#!/bin/bash
result=$(bash "$(dirname "$0")/greet.sh")
if [ "$result" = "hello" ]; then
  exit 0
else
  echo "FAIL: got $result" >&2
  exit 1
fi
