# Luak Windows First Run

This RC uses a portable source zip or checkout. There is no MSI, native executable, Docker image, or Electron/Tauri installer.

## Package/install method

Build a Windows RC zip from a checkout:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\package-windows-zip.ps1
```

The zip is written to `release\luak-0.1.0-windows-rc.zip`. A tester can also clone the repo directly and run the same commands below.

## Prerequisites

- Windows 10/11 with PowerShell or Windows Terminal.
- Node.js 20 or newer.
- npm 10 or newer.
- Git for Windows if cloning from source or running repo-execution tasks.
- Browser: Edge, Chrome, or Firefox.
- Ollama/provider keys are optional and only needed for live adapters. Offline smoke does not require them.

Python is not required for the RC smoke path.

## Configure `.env`

Copy the example only if you want persistent local provider/service settings:

```powershell
Copy-Item .env.example .env
```

For publishable local evidence, set a signing key before `npm run serve`:

```powershell
$env:LUAK_HMAC_KEY = -join ((1..64) | ForEach-Object { '{0:x}' -f (Get-Random -Maximum 16) })
```

## Exact test commands

```powershell
npm ci
npm run build
npm run smoke
npm run serve
```

Open:

```text
http://127.0.0.1:18795/
```

Optional diagnostics:

```powershell
npm run doctor
```

## Expected output

`npm run smoke` should include:

```text
Luak smoke test: deterministic offline mock run.
Smoke passed.
```

`npm run serve` should print:

```text
Luak server running on http://127.0.0.1:18795
UI: http://127.0.0.1:18795/
```

## Cleanup

Stop the server with `Ctrl+C`, then run:

```powershell
npm run clean:state -- --confirm
```

Delete the extracted zip or checkout folder.

## Known RC gaps

- Native Windows has not been personally verified yet.
- `better-sqlite3` is a native dependency and must be validated on clean Windows with the selected Node version.
- The zip is portable source, not an installed app.
- Global npm/npx UX is not the recommended RC path because server startup still uses `npm run serve`.
