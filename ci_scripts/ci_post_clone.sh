#!/bin/sh
set -e

cd apps/mobile/ios
pod install --repo-update
