---
name: iconslibrary
description: Find exact IconsLibrary catalogue drawings and install or reinstall icons, My Kit snapshots, and supported Motion in a consumer project with the IconsLibrary CLI. Use when adding IconsLibrary assets or integrating their local playback into an existing app.
---

# IconsLibrary

## Start in the consumer project

Inspect `iconslibrary/manifest.json`, the framework and its asset conventions, and existing icon and playback components. Retain the project's family, local names, and version pins unless the developer asks to change them. Use `iconslibrary reinstall NAME ...` to restore recorded files, or omit the names to restore all recorded files. Keep the manifest and Kit notices with the delivered files.

Use `@iconslibrary/cli` version `0.1.0` with Node.js 22 or later. If the project supplies a launcher for the pinned package, use it. Otherwise use either launcher below with the desired arguments in place of `--help`.

```sh
npx --yes --package=@iconslibrary/cli@0.1.0 -- iconslibrary --help
bunx --package @iconslibrary/cli@0.1.0 iconslibrary --help
```

Commands below use `iconslibrary` as shorthand for that launcher. Run them from the consumer project root.

## Choose exact drawings and install

```sh
iconslibrary search "CONCEPT" --family=FAMILY --json
iconslibrary inspect KEY[:MASTER] --json
iconslibrary add KEY:MASTER=LOCAL_NAME OTHER_KEY:OTHER_MASTER=OTHER_NAME --format=svg
iconslibrary kit KIT_ID --as=LOCAL_NAME --version=VERSION
```

Use the project's family in search, or omit `--family` when comparing families. Compare catalogue names, variants, preview links, and inspected `alternatives`. Explain the visible or descriptive difference between plausible drawings. Use a distinct local name per selection and the `key` and `selection.masterId` from the exact inspected record, even for different drawings of the same concept. Use `outputs` to choose SVG or PNG. If the brief leaves a material choice unresolved, present the options to the developer.

Use the developer's existing Kit ID and the account or organisation that owns it. Omit `--version` to install the current snapshot, or assert the supplied snapshot version. Reinstall by the recorded local name to retain that snapshot. Use `--workspace=WORKSPACE_ID` for drawing inspection and drawing or Motion installation with an organisation-bound credential when the workspace is specified.

Read the resulting manifest for paths, version pins, receipts, and checksums. Reference installed files through the framework's existing static assets, imports, or image components. For ordinary HTML and JSX use a local image URL. Keep the delivered bytes and manifest intact. Use the Kit's own manifest to find its files and saved settings.

## Choose and play Motion

Inspect the exact drawing's `motion.effects`, native recordings, and `motion.transformations`. For Smart Transform, verify the pair's source and destination match the intended state change. Inspect with the chosen effect or pair again and check `selectedMotion.outputs` before installing. For a released native recording use `--effect=native --recording='<JSON choice from inspection>'`.

```sh
iconslibrary inspect KEY:MASTER --effect=EFFECT --json
iconslibrary inspect KEY:MASTER --pair=PAIR --json
iconslibrary motion KEY:MASTER --effect=EFFECT --format=FORMAT --as=LOCAL_NAME --trigger=press
```

For a pair, substitute `--pair=PAIR` for `--effect=EFFECT`. Explain what the authored Motion communicates and what event starts it. `--trigger` records the event (`programmatic`, `hover`, `press`, `toggle`, or `state-change`). Wire that event through the app's existing controls. Use native local image playback for Animated SVG, APNG, and GIF and a local video source for WebM when inspection offers those outputs. For a simple press-to-play image, start with the installed still, swap to the installed animated source on press, and restore the still on stop. Respect `prefers-reduced-motion`, including preference changes, by keeping or restoring the still. Check display and playback with networking disabled.

## Use the account's existing access

Use the established CLI login or a deployment credential that the build environment already provides as `ICONSLIBRARY_DEPLOYMENT_TOKEN`. For interactive setup, run `iconslibrary login`. Add `--kits` when Kit access is needed. Let the account owner sign in at IconsLibrary, choose Personal or the organisation, and approve in the browser. Leave credentials in private CLI or build-secret storage. Never read, print, request, or write secret values into the conversation, source, or logs.

Report the specific failure and preserve the existing files. For missing or expired login, ask the owner to approve again. For insufficient scope, entitlement, or Kit access, use the authorised account, scope, or workspace. For an unsupported output, show the options listed for that exact drawing and Motion. For a collision, keep the existing selection and choose a new name with the developer. For a version or checksum mismatch, keep the recorded pins and report the mismatch. Use the normal access checks for every install and replay.
