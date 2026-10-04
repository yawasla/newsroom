# Yawasla

Yawasla is an online newsroom solution for associations managing mosques, helping them with their communication (Janaza prayer announcements, news, donation appeals, etc.), broadcasted via mail and push notifications.

[![license](https://img.shields.io/github/license/yawasla/newsroom.svg)](https://github.com/yawasla/newsroom/blob/main/LICENSE)

> ⚠️ **Beta in development** — targeted launch: Q1 2027. See the [roadmap](#roadmap) below.

The project is built around a minimal, lightweight open-source core (Apache 2.0 license), designed to be simple to install and use, even by beginners.

## Table of contents

- [Quick start](#quick-start)
- [Building a release](#building-a-release)
- [Tech stack](#tech-stack)
- [Roadmap](#roadmap)
- [Contact](#contact)
- [Responsibility](#responsibility)
- [License](#license)

## Quick start

⚠️ The project is still at an early beta stage — installation and authentication work, business features are in progress.

#### Requirements

- PHP 8.0+
- Composer
- MySQL 8.0+ / MariaDB 10.11+ (SQLite supported, not recommended in production)
- Node 22+ and npm

#### Backend setup

```
cd back
composer install
php -S localhost:8000 -t public
```

The `.env` file is optional at this point: without it, the installation wizard asks for the database credentials and writes it. To set it up by hand instead, copy `.env.example` to `.env` and edit it.

#### Frontend setup

```
cd front
cp .env.example .env.local
npm install
npm run dev
```

In dev, `/api` calls are proxied to the PHP backend (`VITE_API_PROXY_TARGET`, `http://localhost:8000` by default). Open the Vite URL: the installation wizard takes over.

## Building a release

The release script builds a clean, ready-to-install archive (compiled frontend, production PHP dependencies, no dev files).

#### Requirements

- Node 22+ and npm
- PHP and Composer (if Composer is not in your `PATH`, e.g. a shell alias, point to it with `COMPOSER_BIN=/path/to/composer.phar`)

#### Steps

From the project root, run:

```
node scripts/release.mjs
```

This produces `dist/yawasla-dev.zip` with its `.sha256` checksum and `version.json` (`dist/` is not versioned), including any uncommitted changes. A git repository is not required. Uploading the archive and `version.json` together to a test distribution server lets you try the automatic update without committing: never edit `version.json` by hand, or its checksum will no longer match the archive.

#### Official release

1. Set the version in `back/public/index.php` (`define('APP_VERSION', 'x.y.z')`), with a matching migration in `back/database/migrations/` if the database schema changed
2. Commit your changes: with `--release`, the script refuses to run on a dirty working tree, so that every published archive matches a commit
3. From the project root, run:

```
node scripts/release.mjs --release
```

This produces `dist/yawasla-x.y.z.zip`, `dist/yawasla-x.y.z.zip.sha256` and `dist/version.json`.

4. Upload the archive and `version.json` side by side to the distribution server (`https://dist.yawasla.org/`): installed sites detect the new version and update in one click from the administration. Optionally, tag the commit (`git tag vx.y.z`) and attach the archive and its checksum to a GitHub release.

#### Deployment

Unzip the archive on the server and point the site's document root to the `public/` folder, then open the site: the installation wizard takes over. SSL is required.

On shared hosting, rename `public/` to your host's web folder (OVH: `www/`, cPanel: `public_html/`) and upload the archive content to its parent folder.

## Tech stack

- **Backend**: PHP 8.0+ with [Slim](https://www.slimframework.com/), a custom lightweight ORM (Active Record over [Medoo](https://medoo.in/)) with an APCu object cache
- **Frontend**: React (compiled via npm)
- **Database**: MySQL / MariaDB / SQLite
- **Notifications**: Brevo API (mail), Service Workers (push) — kept interchangeable, no hard coupling to Brevo
- **License**: Apache 2.0

More architecture details in [CLAUDE.md](./CLAUDE.md).

## Roadmap

The project moves forward step by step, keeping a deliberately restricted beta scope:

- **Q1 2027** — Technical foundation, authentication, organization & announcement management, public newsroom page
- **Q2 2027** — Brevo mail integration, push notifications, mail subscription to announcements
- **Q3 2027** — Full user management, account & display settings
- **Q4 2027** — Dashboard & charts, showcase site on yawasla.org, technical documentation

Full detail in [CLAUDE.md](./CLAUDE.md#todo).

## Contact

- Mail: [contact@yawasla.org](mailto:contact@yawasla.org)
- Github: <https://github.com/yawasla/newsroom>

## Responsibility

Author disclaims any responsibility for the use that is made with this tool.

```text
Al-Nu'man ibn Bashir reported,
The Messenger of Allah (Peace and Blessings be upon Him) said: « Verily, the lawful is clear and the unlawful is clear, and between the two of them they are doubtful matters about which many people don't know. Thus, he who avoids doubtful matters clears himself in regard to his religion and his honor, and he who falls into doubtful matters will fall into the unlawful as the shepherd who pastures near a sanctuary, all but grazing there in. Verily, every king has a sanctum and the sanctum of Allah is his prohibitions. Verily, in the body is a piece of flesh which, if sound, the entire body is sound, and if corrupt, the entire body is corrupt. Truly, it is the heart. »
Sahih al-Bukhārī 52, Sahih Muslim 1599
```

```text
D'après Nu'man Ibn Bachir (qu'Allah l'agrée),
Le Messager d'Allah (que La Prière d'Allah et Son Salut soient sur Lui) a dit : « Certes le halal est clair et certes le haram est clair et il y a entre les deux des choses ambiguës que peu de gens connaissent. Celui qui s'écarte des choses ambiguës a préservé sa religion et son honneur. Quant à celui qui tombe dans les choses ambiguës il tombe dans le haram comme le berger qui fait paitre ses bêtes près d'un enclos réservé et qui sont sur le point de rentrer dedans. Certes chaque roi a un domaine réservé et certes le domaine réservé d'Allah est ses interdits. Certes il y a dans le corps un morceau de chair, si il est bon alors l'ensemble du corps est bon tandis que si il est mauvais alors c'est l'ensemble du corps qui est mauvais, certes il s'agit du coeur. »
Sahih al-Bukhārī 52, Sahih Muslim 1599
```

## License

Copyright © Yawasla contributors

Licensed under the [Apache License 2.0](./LICENSE).
