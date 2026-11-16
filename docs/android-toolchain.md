# Android toolchain: JDK 21 and Kotlin

The Android build needs a **JDK 21** with `javac`. A JRE alone is not enough: Gradle,
AGP 8.13 and the Capacitor modules compile Java sources with `--release 21`, so a JDK
whose `bin/` has no compiler fails with messages such as:

```text
Toolchain installation '/usr/lib/jvm/java-25-openjdk-amd64' does not provide the required capabilities: [JAVA_COMPILER]
invalid source release: 21
```

## 1. Use the JDK already bundled with Android Studio

On this machine Android Studio ships a JDK 21 at `/opt/android-studio/jbr`:

```bash
/opt/android-studio/jbr/bin/javac -version
# javac 21.0.7
```

Use it for Gradle without changing the system default:

```bash
cd android
JAVA_HOME=/opt/android-studio/jbr \
ANDROID_HOME="$HOME/Android/Sdk" \
./gradlew testDebugUnitTest assembleDebug
```

For a persistent per-user setting, put this in `~/.gradle/gradle.properties`:

```properties
org.gradle.java.home=/opt/android-studio/jbr
```

And point Gradle at the SDK in the git-ignored `android/local.properties`:

```properties
sdk.dir=/home/cjrutherford/Android/Sdk
```

If Gradle is already running with the old JVM, stop the daemon once:

```bash
./gradlew --stop
```

## 2. Install a standalone JDK 21

### Ubuntu / Debian

```bash
sudo apt update
sudo apt install openjdk-21-jdk
sudo update-alternatives --config java
sudo update-alternatives --config javac
```

Or with SDKMAN, no sudo:

```bash
curl -s "https://get.sdkman.io" | bash
source "$HOME/.sdkman/bin/sdkman-init.sh"
sdk install java 21.0.7-tem
sdk default java 21.0.7-tem
```

### macOS

```bash
brew install --cask temurin@21
export JAVA_HOME=$(/usr/libexec/java_home -v 21)
```

### Windows

Use Android Studio's bundled JBR, usually:

```text
C:\Program Files\Android\Android Studio\jbr
```

Set `org.gradle.java.home` in `%USERPROFILE%\.gradle\gradle.properties` and use forward
slashes, for example `C:/Program Files/Android/Android Studio/jbr`.

Verify the compiler, not only the runtime:

```bash
java -version
javac -version
```

Both must report 21.

## 3. Kotlin

The project currently pins **Kotlin 1.9.25**, which supports JDK 21 and is what CI uses.
Keeping it is the lowest-risk option; the JDK is the actual build blocker.

If you do update Kotlin, change all of these together so the plugin, compiler and stdlib
cannot drift:

1. `android/build.gradle` — `org.jetbrains.kotlin:kotlin-gradle-plugin`.
2. `android/variables.gradle` — `kotlinVersion`.
3. `android/app/build.gradle` — the forced `kotlin-stdlib*` versions.
4. Any Gradle version catalog or plugin alias if one is introduced later.

Then run:

```bash
cd android
./gradlew --stop
JAVA_HOME=/opt/android-studio/jbr ANDROID_HOME="$HOME/Android/Sdk" \
  ./gradlew clean testDebugUnitTest assembleDebug
```

Notes:

- Kotlin 1.8+ merged the old `kotlin-stdlib-jdk7` / `kotlin-stdlib-jdk8` artifacts into
  `kotlin-stdlib`. Keep the excludes in `android/build.gradle`; some Capacitor/cordova
  test dependencies still pull the 1.6.x stubs and would otherwise duplicate classes.
- Room uses kapt in this project. kapt still works with Kotlin 2.x, but Android Studio may
  warn. Migrating to KSP is a separate change and should be tested on its own.
- Do not upgrade Kotlin only in `variables.gradle`; the Gradle plugin classpath is the
  authoritative compiler version.

## 4. Verify the full Android gate

```bash
cd android
JAVA_HOME=/opt/android-studio/jbr ANDROID_HOME="$HOME/Android/Sdk" \
  ./gradlew testDebugUnitTest assembleDebug

# Migration and Room behaviour on an emulator/device:
JAVA_HOME=/opt/android-studio/jbr ANDROID_HOME="$HOME/Android/Sdk" \
  ./gradlew connectedDebugAndroidTest
```

The current recent-history migration test is:

```bash
./gradlew connectedDebugAndroidTest \
  -Pandroid.testInstrumentationRunnerArguments.class=net.christopherrutherford.statocyst.db.VideoMigrationTest
```
