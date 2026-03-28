# Lucent Code Distribution Guide

<div align="center">

**Building and distributing Lucent Code for macOS**

</div>

---

## Table of Contents

- [Quick Start](#quick-start)
- [Development Build](#development-build)
- [Production Build](#production-build)
- [Bundle Size](#bundle-size)
- [Code Signing](#code-signing)
- [Notarization](#notarization)
- [Creating a DMG](#creating-a-dmg)
- [Automated Release](#automated-release)
- [Troubleshooting](#troubleshooting)

---

## Quick Start

### Prerequisites

```bash
# Install dependencies
npm install

# For code signing (optional, for distribution)
# You'll need:
# - Apple Developer account
# - Developer certificate
# - Application Specific Password
```

### Build for Distribution

```bash
# Build universal DMG (recommended for distribution)
npm run dist:mac:universal

# Output: release/Lucent Code-0.1.0-universal.dmg
```

---

## Development Build

### Folder Build (fastest for testing)

```bash
# Build and package without creating installer
npm run pack

# Output: release/mac-universal/Lucent Code.app
```

This creates an unsigned `.app` bundle that you can:
- Open directly: `open release/mac-universal/Lucent\ Chat.app`
- Copy to `/Applications` for testing
- Share with others (will show "unverified developer" warning)

---

## Production Build

### Architecture-Specific Builds

```bash
# Apple Silicon (M1/M2/M3/M4)
npm run dist:mac:arm64

# Intel Macs
npm run dist:mac:x64

# Universal (runs natively on both)
npm run dist:mac:universal
```

### Build Outputs

After running `npm run dist:mac:universal`:

```
release/
├── Lucent Code-0.1.0-universal.dmg      # DMG installer (for distribution)
├── Lucent Code-0.1.0-universal.zip      # ZIP archive (alternative)
└── mac-universal/
    └── Lucent Code.app                   # Unsigned .app bundle
```

---

## Bundle Size

### What's in the package

The `.app` bundle breaks down roughly as:

| Component | Size | Notes |
|-----------|------|-------|
| Electron Frameworks | ~263 MB | Chromium + Node — unavoidable |
| `runtime/` (pi-coding-agent) | ~400 MB | See below |
| `audio-service/` | ~120 KB | Small |

The `runtime/` directory (shipped via `extraResources`) contains the coding-agent Node process and is the main lever for reducing app size.

### Runtime size breakdown

| Item | Size | Avoidable? |
|------|------|------------|
| Bundled Node binary | ~107 MB | No — needed to spawn agent process |
| `@gsd-build/engine-*.node` | ~74 MB | No — native addon |
| `koffi` (FFI bindings) | ~76 MB raw | Partially — 18 platform builds shipped; only `darwin_*` needed |
| `tsx` | ~20 MB | **Yes — build tool, not runtime** |
| `sql.js` dist variants | ~18 MB raw | Partially — only `sql-wasm.js/wasm` needed |
| `@babel/` | ~15 MB | Dep of jiti; minimally reducible |
| `7zip-bin` | ~12 MB | **Yes — electron-builder dep, not runtime** |
| `workbox-build` | ~11 MB | **Yes — PWA build tool, not runtime** |
| `esbuild` + `@esbuild` | ~19 MB | **Yes — bundler, not runtime** |
| `playwright-core` | ~9.6 MB | **Yes — test framework, not runtime** |

### Optimizations applied (in `bundle.cjs`)

The bundle script (`packages/pi-coding-agent/scripts/bundle.cjs`) applies these reductions automatically on every `npm run bundle`:

1. **DEV_ONLY_DIRS exclusions** — `tsx`, `7zip-bin`, `workbox-build`, `playwright-core`, `esbuild`, `@esbuild` are excluded from node_modules copy (~71 MB saved)
2. **koffi platform stripping** — after copy, all non-mac platform prebuilds are deleted; only `darwin_arm64` and `darwin_x64` are kept for universal builds (~68 MB saved)
3. **koffi source/docs stripping** — `src/`, `vendor/`, `doc/` are removed from koffi post-copy (~9.5 MB saved)
4. **sql.js variant stripping** — only `sql-wasm.js`, `sql-wasm.wasm`, `worker.sql-wasm.js` are kept; all asm, browser, and debug variants are removed (~16.5 MB saved)

**Total estimated savings: ~165 MB** off the runtime directory per build.

### Future reduction opportunities

- **Compress the Node binary** with `upx` (can halve the 107 MB binary, but complicates notarization)
- **Replace `sql.js` WASM with `better-sqlite3`** (native binding, ~2 MB vs 18 MB)
- **Tree-shake `@babel/`** (jiti may not need all Babel packages)
- **Strip `@gsd-build` symbols** with `strip -S` after signing (saves ~10–20 MB on native addon)

---

## Code Signing

### Why Sign Your App?

- **Required for distribution** outside of local testing
- **Prevents Gatekeeper warnings** ("can't be opened because it is from an unidentified developer")
- **Required for notarization** (macOS 10.15+)
- **Enables automatic updates** (future feature)

### Setting Up Code Signing

#### 1. Get a Developer Certificate

```bash
# Open Xcode
# Xcode → Preferences → Accounts → Add Apple ID
# Or: https://developer.apple.com/account/resources/certificates/list

# Create a "Developer ID Application" certificate
# Download and install in Keychain Access
```

#### 2. Find Your Certificate Identity

```bash
# List available signing identities
security find-identity -v -p codesigning

# Look for: "Developer ID Application: Your Name (TEAM_ID)"
# Example: Developer ID Application: John Doe (ABCD123456)
```

#### 3. Configure electron-builder

Create `electron-builder.env` in the studio directory:

```bash
# For automatic signing (uses your Apple ID)
CSC_LINK_PKCS12_FILE_BASE64=""
CSC_KEY_PASSWORD=""

# Or specify identity directly (recommended)
CSC_IDENTITY="Developer ID Application: Your Name (TEAM_ID)"
```

Or add to package.json build config:

```json
{
  "build": {
    "mac": {
      "identity": "Developer ID Application: Your Name (TEAM_ID)"
    }
  }
}
```

### Manual Signing (for testing)

```bash
# After building, sign manually
codesign --force --deep --sign "Developer ID Application: Your Name (TEAM_ID)" \
  "release/mac-universal/Lucent Code.app"

# Verify signature
codesign --verify --verbose "release/mac-universal/Lucent Code.app"
```

---

## Notarization

### What is Notarization?

Apple's security check for apps distributed outside the App Store. Required for:
- macOS Catalina (10.15) and later
- Apps downloaded from the internet
- Avoiding Gatekeeper warnings

### Setting Up Notarization

#### 1. Create App-Specific Password

```bash
# Go to: https://appleid.apple.com
# Sign In → Security → App-Specific Passwords
# Generate: Label "Lucent Code Notarization"
# Copy the password (format: abcd-efgh-ijkl-mnop)
```

#### 2. Set Up Environment Variables

Create `electron-builder.env`:

```bash
# Apple ID email
APPLE_ID="your-email@example.com"

# App-specific password
APPLE_ID_PASSWORD="abcd-efgh-ijkl-mnop"

# Team ID (from developer account)
APPLE_TEAM_ID="TEAM_ID123"
```

#### 3. Enable Notarization in electron-builder

Add to package.json:

```json
{
  "build": {
    "mac": {
      "notarize": {
        "teamId": {
          "default": "TEAM_ID123"
        }
      }
    },
    "afterSign": "notarize.js"
  }
}
```

### Manual Notarization (for troubleshooting)

```bash
# 1. Create the app (run dist:mac:universal)
# 2. Zip the app
zip -r LucentChat.zip "release/mac-universal/Lucent Code.app"

# 3. Submit for notarization
xcrun notarytool submit \
  --apple-id "your-email@example.com" \
  --password "app-specific-password" \
  --team-id "TEAM_ID123" \
  --file "LucentChat.zip" \
  --wait

# 4. Staple the ticket to the app
xcrun stapler staple "release/mac-universal/Lucent Code.app"
```

---

## Creating a DMG

The build process automatically creates a DMG. Here's how it's configured:

### DMG Configuration

```json
{
  "build": {
    "dmg": {
      "title": "Lucent Code",
      "background": "build/dmg-background.png",
      "icon": "build/icon.icns",
      "iconSize": 80,
      "contents": [
        { "x": 130, "y": 220 },                    // App icon
        { "x": 410, "y": 220, "type": "link", "path": "/Applications" }  // Applications folder
      ],
      "window": {
        "width": 540,
        "height": 380
      }
    }
  }
}
```

### Custom DMG Background

Place your background at `build/dmg-background.png`:

- **Size**: 540×380 pixels (minimum)
- **Format**: PNG with transparency
- **Design**: Include window title, drag area indicator, app icon placement hint

Example layout:
```
┌─────────────────────────────────────────┐
│  Lucent Code                            │
│                                          │
│     [APP ICON]    →→→ [Applications]    │
│                                          │
│  Drag Lucent Code to Applications        │
│                                          │
└─────────────────────────────────────────┘
```

### Custom App Icon

1. Create your icon (1024×1024 PNG)
2. Convert to `.icns`:
   ```bash
   # Using iconutil (macOS built-in)
   mkdir icon.iconset
   sips -z 16 16     icon.png --out icon.iconset/icon_16x16.png
   sips -z 32 32     icon.png --out icon.iconset/icon_16x16@2x.png
   sips -z 32 32     icon.png --out icon.iconset/icon_32x32.png
   sips -z 64 64     icon.png --out icon.iconset/icon_32x32@2x.png
   sips -z 128 128   icon.png --out icon.iconset/icon_128x128.png
   sips -z 256 256   icon.png --out icon.iconset/icon_128x128@2x.png
   sips -z 256 256   icon.png --out icon.iconset/icon_256x256.png
   sips -z 512 512   icon.png --out icon.iconset/icon_256x256@2x.png
   sips -z 512 512   icon.png --out icon.iconset/icon_512x512.png
   sips -z 1024 1024 icon.png --out icon.iconset/icon_512x512@2x.png
   iconutil -c icns icon.iconset

   # Or using online tools
   # https://cloudconvert.com/png-to-icns
   # https://www.img2icnsapp.com/
   ```
3. Place at `build/icon.icns`

---

## Automated Release

### GitHub Actions (Recommended)

Create `.github/workflows/release.yml`:

```yaml
name: Release

on:
  push:
    tags:
      - 'v*'

jobs:
  release:
    runs-on: macos-latest

    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install dependencies
        run: |
          cd studio
          npm ci

      - name: Build and notarize
        env:
          APPLE_ID: ${{ secrets.APPLE_ID }}
          APPLE_ID_PASSWORD: ${{ secrets.APPLE_ID_PASSWORD }}
          APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
        run: |
          cd studio
          npm run dist:mac:universal

      - name: Upload DMG
        uses: softprops/action-gh-release@v1
        with:
          files: studio/release/*.dmg
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### Required GitHub Secrets

Set these in your repo settings (Settings → Secrets → Actions):

- `APPLE_ID` — Your Apple ID email
- `APPLE_ID_PASSWORD` — App-specific password
- `APPLE_TEAM_ID` — Your Developer Team ID

---

## Version Management

### Update Version Number

```bash
# Update package.json version
npm version patch  # 0.1.0 → 0.1.1
npm version minor  # 0.1.0 → 0.2.0
npm version major  # 0.1.0 → 1.0.0

# Or edit manually
# "version": "0.1.0"
```

### Release Workflow

```bash
# 1. Update version
npm version minor

# 2. Build
npm run dist:mac:universal

# 3. Test the DMG
open release/Lucent\ Chat-0.2.0-universal.dmg

# 4. Create git tag
git add .
git commit -m "Release v0.2.0"
git tag v0.2.0
git push origin main --tags
```

---

## Distribution Checklist

Before distributing publicly:

- [ ] Updated version number in `package.json`
- [ ] Tested the built app on clean macOS system
- [ ] Code signing configured (or skipped for testing)
- [ ] Notarization working (for public distribution)
- [ ] App icon created and looks good
- [ ] Microphone permission description clear
- [ ] DMG background created (optional but recommended)
- [ ] Tested DMG opens and installs correctly
- [ ] Verified voice service works in packaged app
- [ ] Checked file system permissions
- [ ] Readme and license included

---

## Troubleshooting

### App Won't Open ("damaged")

```bash
# Remove extended attributes
xattr -cr "release/mac-universal/Lucent Code.app"

# If signed, verify signature
codesign --verify --verbose "release/mac-universal/Lucent Code.app"
```

### Notarization Failed

```bash
# Check notarization status
xcrun notarytool history \
  --apple-id "your-email@example.com" \
  --password "app-specific-password" \
  --team-id "TEAM_ID123"

# View notarization log
xcrun notarytool log \
  --apple-id "your-email@example.com" \
  --password "app-specific-password" \
  --team-id "TEAM_ID123" \
  <request-id>
```

### Gatekeeper Warning After Download

This means the app isn't signed. Users can bypass:
1. Right-click the DMG
2. Select "Open"
3. Click "Open" in the dialog

Or run in terminal:
```bash
xattr -d com.apple.quarantine Lucent\ Chat.app
```

### Build Fails with "electron-builder not found"

```bash
# Install dependencies
npm install

# Or globally
npm install -g electron-builder
```

### DMG Creation Fails

```bash
# Check if build directory exists
mkdir -p build

# Or disable DMG and build ZIP only
npm run dist:mac:x64
```

---

## Advanced: Custom Build Configuration

### Target Specific macOS Versions

```json
{
  "build": {
    "mac": {
      "minimumSystemVersion": "10.15.0"
    }
  }
}
```

### Add File Associations

```json
{
  "build": {
    "mac": {
      "fileAssociations": [
        {
          "ext": "lc",
          "name": "Lucent Code Session",
          "role": "Editor"
        }
      ]
    }
  }
}
```

### Enable Auto-Update

```json
{
  "build": {
    "publish": {
      "provider": "github",
      "owner": "your-username",
      "repo": "lucent-code"
    }
  }
}
```

---

## Resources

- [electron-builder Docs](https://www.electron.build/)
- [Electron Code Signing Guide](https://www.electronjs.org/docs/latest/tutorial/code-signing)
- [Apple Notarization Guide](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)
- [DMG Design Best Practices](https://github.com/sindresorhus/create-dmg)
