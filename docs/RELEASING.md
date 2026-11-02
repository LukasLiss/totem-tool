# Releasing a new version

One git tag releases everything. Pushing a tag like `v1.2.3` starts two GitHub
Actions workflows:

| Workflow | What it builds | Where it goes |
|---|---|---|
| `electron` | Desktop installers for Windows, macOS Apple Silicon and macOS Intel | A **draft** GitHub Release |
| `Docker image` | Server image for `linux/amd64` and `linux/arm64` | `ghcr.io/lukasliss/totem-tool` |

The website's download links only pick up the new version once you **publish**
the draft. The Docker image goes live as soon as its workflow finishes, without
waiting for that.

## Steps

Examples use version `1.2.3`.

### 1. Bump the version on a release branch

The version lives in three `package.json` files, each with a lockfile, and all
three must be updated.

```bash
git fetch origin && git switch -c release/1.2.3 origin/main
```

```bash
npm version 1.2.3 --no-git-tag-version && npm version 1.2.3 --no-git-tag-version --prefix electron && npm version 1.2.3 --no-git-tag-version --prefix frontend
```

```bash
git commit -am "Release 1.2.3" && git push -u origin release/1.2.3 && gh pr create --base main --title "Release 1.2.3" --body "Bump version to 1.2.3"
```

### 2. Merge the PR

Do this **before** tagging. Nothing checks that the tag matches `package.json`,
so a tag on the wrong commit builds installers with the old version number. See
[If a tag went out wrong](#if-a-tag-went-out-wrong).

### 3. Tag `main`

```bash
git fetch origin && git tag -a v1.2.3 origin/main -m "Release 1.2.3"
```

Check that this prints `1.2.3` before you push:

```bash
git show v1.2.3:package.json | grep '"version"'
```

### 4. Push the tag

This starts both workflows.

```bash
git push origin v1.2.3
```

Follow the runs:

```bash
gh run list --branch v1.2.3
```

### 5. Test the draft

Download the installers from the draft on the
[Releases page](https://github.com/LukasLiss/totem-tool/releases). Install and
launch them on each platform you can reach. The draft should contain:

- Versioned installers and their `.blockmap` files
- `latest.yml` and `latest-mac.yml`, used by the app's auto-update
- Version-free copies: `TOTeM-Tool-Windows-x64.exe`,
  `TOTeM-Tool-macOS-AppleSilicon.dmg` and `TOTeM-Tool-macOS-Intel.dmg`

### 6. Publish

Publishing makes the website's links and the app's auto-update point to the new
version.

```bash
gh release edit v1.2.3 --draft=false --latest
```

## How the website links work

The website links to the version-free copies through GitHub's "latest release"
address, so it needs no change for a release:

```
https://github.com/LukasLiss/totem-tool/releases/latest/download/TOTeM-Tool-Windows-x64.exe
https://github.com/LukasLiss/totem-tool/releases/latest/download/TOTeM-Tool-macOS-AppleSilicon.dmg
https://github.com/LukasLiss/totem-tool/releases/latest/download/TOTeM-Tool-macOS-Intel.dmg
```

These always serve the newest published release that is not a draft or a
prerelease. The links keep working only if those file names stay the same; they
are set in `.github/workflows/electron.yml`.

## Docker image

No separate steps are needed. The tag from step 4 publishes these image tags:

| Image tag | Meaning |
|---|---|
| `1.2.3` | This exact version; never moves on a later release |
| `latest` | Newest tagged release; moves on every `v*` tag |
| `main` | Newest commit on `main`, unreleased |

`latest` moves when the workflow finishes, even while the GitHub Release is
still a draft. If you run `latest` on a server, a bad tag can reach it, so pin a
version there.

### Updating a server

With the pinned image, change the version and recreate the container. Data stays
in the `totem-data` volume, and migrations run on start.

```bash
docker pull ghcr.io/lukasliss/totem-tool:1.2.3
```

```bash
docker stop totem && docker rm totem
```

```bash
docker run -d --name totem --restart unless-stopped -p 8000:8000 -v totem-data:/data --env-file .env ghcr.io/lukasliss/totem-tool:1.2.3
```

`docker-compose.yml` builds the image from the checkout instead of pulling it.
If you run it that way, check out the tag and rebuild:

```bash
git fetch --tags && git checkout v1.2.3 && docker compose up -d --build
```

[DOCKER.md](DOCKER.md) lists all settings, including upload and project limits.

## If a tag went out wrong

Act quickly: this stops the build before a draft is finished.

Cancel the running workflows:

```bash
gh run list --branch v1.2.3 --json databaseId -q '.[].databaseId' | xargs -n1 gh run cancel
```

Delete the tag on GitHub and locally:

```bash
git push origin :refs/tags/v1.2.3 && git tag -d v1.2.3
```

Then:

1. If a draft for that version appeared on the Releases page, delete it.
2. Fix the cause and repeat from step 3.

If the Docker workflow finished first, `1.2.3` and `latest` already exist. The
next run of that tag replaces both.

## Signing

The `electron` workflow signs and notarizes builds using these repository
secrets. Without them it still builds, but the installers are unsigned, which is
fine for testing but not for release.

- macOS: `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`,
  `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`
- Windows: `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD`
