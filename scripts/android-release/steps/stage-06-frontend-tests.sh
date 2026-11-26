#!/usr/bin/env bash
pnpm install --frozen-lockfile
pnpm test
pnpm run build
