# IconsLibrary developer tools

Install approved IconsLibrary drawings, My Kit snapshots and supported Motion into a project. The CLI records exact versions, checksums and delivery receipts. Your application displays the installed files locally.

## Sign in and install

Use Node.js 22 or later. Run commands from the root of your project.

```sh
npx --yes --package=@iconslibrary/cli@0.1.0 -- iconslibrary login --kits
npx --yes --package=@iconslibrary/cli@0.1.0 -- iconslibrary search Home --family=minimal --json
bunx --package @iconslibrary/cli@0.1.0 iconslibrary login --kits
bunx --package @iconslibrary/cli@0.1.0 iconslibrary search Home --family=minimal --json
```

Choose either launcher. Sign in at IconsLibrary, verify the code, and approve the Personal or organisation account that should issue the assets. `--no-open` prints the approval URL for manual use. `--kits` requests Kit read access. Local credentials live outside your project. The CLI connects to `https://iconslibrary.com` by default.

Core Minimal is available with a Free account. Paid drawings require an active entitlement for the chosen account or organisation. Your account and applicable artwork terms determine which assets you can download and use. [IconsLibrary Terms](https://iconslibrary.com/legal/terms)

## Select a drawing, a Kit or Motion

In the examples below, `iconslibrary` stands for either launcher above. Use keys, master IDs, effect IDs and pair IDs returned by the CLI. `search` lists names and previews. `inspect` lists alternative drawings, exact IDs and supported formats.

```sh
iconslibrary inspect KEY --json
iconslibrary add FIRST_KEY:FIRST_MASTER=home-01 SECOND_KEY:SECOND_MASTER=home-13
iconslibrary kit "$KIT_ID" --as=project-kit
iconslibrary inspect FIRST_KEY:FIRST_MASTER --effect=EFFECT --json
iconslibrary motion FIRST_KEY:FIRST_MASTER --effect=EFFECT --format=animated-svg --as=home-motion --trigger=press
iconslibrary reinstall home-01 home-13 home-motion project-kit
```

The CLI installs SVG and PNG stills where offered, with distinct names for different drawings of the same concept. For Motion, inspect with `--effect=EFFECT` or `--pair=PAIR` and use one of the returned formats. The supported combinations may offer Animated SVG, GIF, APNG or WebM. `--trigger` records how the app should start playback. The [offline HTML example](examples/offline/index.html) shows local image playback, Stop and reduced motion. To try it, install files named `home-01.svg`, `home-13.svg` and `home-motion.svg` with the commands above, then copy the HTML file next to your `iconslibrary/` directory and open it in a browser.

Kit installation requires its ID and the authority that owns it. Add `--version=N` to require a specific current snapshot. Check the Kit’s own manifest and notices for the saved settings and file paths. Keep `iconslibrary/manifest.json` with your installed files. Reinstall follows the recorded delivery and verifies the original bytes using your current access. Use `--workspace=WORKSPACE_ID` for drawing inspection and drawing or Motion installation when a workspace is specified.

## Install in CI

Create a Deployment credential under **Account → Developer Access** in the applicable Personal or organisation account. Grant `icons:read` for drawings and Motion, and add `kits:read` when the build installs a Kit. Inject the credential as `ICONSLIBRARY_DEPLOYMENT_TOKEN` from the build secret store, then run the same install or reinstall commands. Rotation reveals one replacement and revokes the old credential. Revocation blocks future retrieval with that credential. Installed files continue working offline.

## Use the agent skill

Give your coding agent [the `iconslibrary` skill](skills/iconslibrary/SKILL.md) from this repository. For direct loading in Codex, open the consumer project and ask Codex to read the skill file and use it for the requested icons. For project-level discovery, place the folder at `.agents/skills/iconslibrary/` and ask Codex to use `$iconslibrary`. Let the account owner handle any browser approval. Share the Kit ID and project requirements with the agent and keep credentials in private storage.

## Build and licence

Run `npm ci`, then `npm test`. `npm pack` builds the CLI archive. The [MIT licence](LICENSE) covers the tooling, skill and integration example. Artwork and Motion delivered by the service follow the [IconsLibrary Terms](https://iconslibrary.com/legal/terms) and any notices supplied with the delivery. See [third-party tooling notices](THIRD_PARTY_NOTICES.txt).
