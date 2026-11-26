#!/usr/bin/env bash
# The instrumented tests that need a device (CI's emulator, .github/workflows/ci.yml):
# what Android can take away underneath the app, which no reading of the code
# can check. Each step puts the device in a state and runs the test class
# that asserts the app's behaviour in it. `am instrument` exits 0 whatever
# the result, so the output is read for JUnit's OK line.
set -euo pipefail
cd "$(dirname "$0")"

APP=com.thockdown.soundscapes
RUNNER=$APP.test/androidx.test.runner.AndroidJUnitRunner

./gradlew :app:installDebug :app:installDebugAndroidTest --no-daemon

run() {
  echo "== $1"
  output=$(adb shell am instrument -w -e class "$APP.$1" "$RUNNER")
  echo "$output"
  grep -q '^OK (' <<<"$output"
}

# A fresh install: Android 14 denies exact alarms until the listener grants them.
run ScheduleWithoutExactAlarmsTest
adb shell appops set "$APP" SCHEDULE_EXACT_ALARM allow
run ScheduleWithExactAlarmsTest
# Revoked in the system settings: the system cancels the alarm, and the schedule must read off.
adb shell appops set "$APP" SCHEDULE_EXACT_ALARM deny
run ScheduleWithoutExactAlarmsTest
