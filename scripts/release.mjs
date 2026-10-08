// Construit dist/yawasla-dev.zip (+ .sha256 et version.json) : node scripts/release.mjs [--release]
// Prérequis : Node 22+, npm, PHP, Composer (hors PATH : COMPOSER_BIN=/chemin/vers/composer.phar).
// Release officielle : APP_VERSION dans back/public/index.php (+ migration), commit, --release
// (yawasla-x.y.z.zip, arbre git propre exigé), puis archive et version.json sur dist.yawasla.org.
import { execFileSync, execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { basename, delimiter, dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { crc32, deflateRawSync } from 'node:zlib'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BACK = join(ROOT, 'back')
const FRONT = join(ROOT, 'front')
// Dossier de travail : supprimé une fois l'archive écrite, conservé en cas d'échec pour inspection
const STAGING_ROOT = join(ROOT, 'build')
const STAGING = join(STAGING_ROOT, 'yawasla')
// Copie du front compilée à part : npm ci ne touche pas au node_modules de dev (serveur Vite en cours…)
const FRONT_BUILD = join(STAGING_ROOT, 'front')
const DIST = join(ROOT, 'dist')
const RELEASE = process.argv.includes('--release')

// Même marqueur que Yawasla\Core\AppShell::MARKER
const SHELL_MARKER = '<!-- yawasla:boot -->'
const IGNORED_FILES = new Set(['.DS_Store', 'Thumbs.db'])
// Jamais dans l'archive (ex. dépôts git laissés par Composer quand il installe depuis les sources)
const IGNORED_DIRS = new Set(['.git', '.svn', '.idea'])

function composerCommand() {
  let bin = process.env.COMPOSER_BIN

  if (!bin) {
    try {
      execSync('composer --version', { stdio: 'ignore' })
      return 'composer'
    } catch {
      bin = (process.env.PATH ?? '')
        .split(delimiter)
        .map((dir) => join(dir, 'composer.phar'))
        .find((path) => existsSync(path))
    }
  }

  // Un .phar est lancé via php
  return bin ? `${bin.endsWith('.phar') ? 'php ' : ''}"${bin}"` : 'composer'
}

const COMPOSER = composerCommand()

function step(title) {
  console.log(`\n▶ ${title}`)
}

function fail(message) {
  console.error(`\n✗ ${message}`)
  process.exit(1)
}

// Commandes fixes, sans entrée utilisateur : le shell sert à trouver npm/composer (.cmd sous Windows)
function run(command, cwd) {
  console.log(`  $ ${command}`)

  try {
    execSync(command, { cwd, stdio: 'inherit' })
  } catch {
    // La sortie de la commande est déjà affichée au-dessus
    fail(`Échec de « ${command} ».`)
  }
}

function output(command, cwd = ROOT) {
  return execSync(command, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim()
}

function copy(from, to) {
  cpSync(from, to, { recursive: true, filter: (path) => !IGNORED_FILES.has(basename(path)) })
}

function listFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)

    if (entry.isDirectory()) {
      return IGNORED_DIRS.has(entry.name) ? [] : listFiles(path)
    }

    return IGNORED_FILES.has(entry.name) ? [] : [path]
  })
}

// Version de PHP minimale, d'après composer.json ("^8.0" → "8.0") : publiée dans version.json
function readPhpRequirement() {
  const composer = JSON.parse(readFileSync(join(BACK, 'composer.json'), 'utf8'))
  const match = String(composer.require?.php ?? '').match(/(\d+\.\d+(?:\.\d+)?)/)

  if (!match) {
    fail('Version de PHP requise introuvable dans back/composer.json.')
  }

  return match[1]
}

// Version : public/index.php reste la source unique (define('APP_VERSION', 'x.y.z'))
function readVersion() {
  const index = readFileSync(join(BACK, 'public', 'index.php'), 'utf8')
  const match = index.match(/define\('APP_VERSION',\s*'(\d+\.\d+\.\d+)'\)/)

  if (!match) {
    fail('APP_VERSION introuvable dans back/public/index.php.')
  }

  return match[1]
}

function checkTools() {
  for (const [command, name] of [
    ['node --version', 'Node'],
    ['npm --version', 'npm'],
    ['php --version', 'PHP'],
    [`${COMPOSER} --version`, 'Composer'],
  ]) {
    try {
      console.log(`  ${name} : ${output(command).split('\n')[0]}`)
    } catch {
      fail(`${name} est introuvable (« ${command} »).${name === 'Composer' ? ' Hors du PATH : définir COMPOSER_BIN.' : ''}`)
    }
  }
}

// Strict en --release (archive publiée = un commit), simple avertissement sinon (build de développeur)
function checkGit() {
  let status = null
  try {
    status = output('git status --porcelain')
  } catch {
    // Pas de dépôt git (sources téléchargées en ZIP) ou git absent
  }

  if (status === null) {
    if (RELEASE) {
      fail('--release exige un dépôt git : la distribution doit correspondre à un commit.')
    }
    console.log('  ⚠ pas de dépôt git')
  } else if (status !== '') {
    if (RELEASE) {
      fail('Des modifications ne sont pas commitées : la distribution ne correspondrait à aucun commit.')
    }
    console.log('  ⚠ modifications non commitées incluses')
  } else {
    console.log('  arbre propre')
  }
}

function buildFront() {
  rmSync(STAGING_ROOT, { recursive: true, force: true })
  cpSync(FRONT, FRONT_BUILD, {
    recursive: true,
    filter: (path) => !['node_modules', 'dist', ...IGNORED_FILES].includes(basename(path)),
  })

  run('npm ci', FRONT_BUILD)
  run('npm run build', FRONT_BUILD)

  const html = readFileSync(join(FRONT_BUILD, 'dist', 'index.html'), 'utf8')
  if (!html.includes(SHELL_MARKER)) {
    fail(`Marqueur ${SHELL_MARKER} absent de front/dist/index.html (voir front/index.html).`)
  }
}

function assemble() {
  mkdirSync(STAGING, { recursive: true })

  // Back : sources uniquement (pas de vendor/ de dev, ni .env, ni var/)
  for (const item of ['public', 'src', 'database', 'composer.json', 'composer.lock', '.env.example', '.htaccess']) {
    copy(join(BACK, item), join(STAGING, item))
  }

  // Front : index.html devient le gabarit servi par AppShell, le reste va dans public/
  const frontDist = join(FRONT_BUILD, 'dist')
  for (const entry of readdirSync(frontDist)) {
    if (entry === 'index.html' || IGNORED_FILES.has(entry)) {
      continue
    }
    if (existsSync(join(STAGING, 'public', entry))) {
      fail(`front/dist/${entry} écraserait back/public/${entry}.`)
    }
    copy(join(frontDist, entry), join(STAGING, 'public', entry))
  }
  mkdirSync(join(STAGING, 'resources'))
  copyFileSync(join(frontDist, 'index.html'), join(STAGING, 'resources', 'app.html'))

  for (const file of ['LICENSE', 'README.md']) {
    copyFileSync(join(ROOT, file), join(STAGING, file))
  }
}

function installBackDependencies() {
  run(`${COMPOSER} install --no-dev --prefer-dist --optimize-autoloader --no-interaction --no-progress`, STAGING)
}

// Fichiers utiles au build ou à git mais pas à l'exécution (vendor/ n'est pas touché : ce n'est pas notre code).
// var/ n'est pas livré : ses dossiers sont créés au démarrage.
function removeBuildFiles() {
  const files = ['composer.json', 'composer.lock', join('database', 'migrations', '.gitkeep')]

  for (const file of files) {
    rmSync(join(STAGING, file), { force: true })
  }
}

// php -l sur le code du projet (vendor/ exclu : déjà validé par ses auteurs)
function lintPhp() {
  const files = ['public', 'src', 'database']
    .flatMap((dir) => listFiles(join(STAGING, dir)))
    .filter((file) => file.endsWith('.php'))

  for (const file of files) {
    try {
      execFileSync('php', ['-l', file], { stdio: 'pipe' })
    } catch (error) {
      fail(`Erreur de syntaxe PHP :\n${error.stdout?.toString() ?? error.message}`)
    }
  }

  console.log(`  ${files.length} fichiers PHP valides`)
}

function dosDateTime(date) {
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  }
}

// Écriture ZIP minimale (deflate, noms UTF-8), pour ne dépendre ni d'un paquet npm ni de l'outil zip
function createZip(files, baseDir, prefix) {
  const locals = []
  const centrals = []
  let offset = 0

  for (const file of files) {
    const data = readFileSync(file)
    const compressed = deflateRawSync(data, { level: 9 })
    const name = Buffer.from(`${prefix}/${relative(baseDir, file).split(sep).join('/')}`, 'utf8')
    const checksum = crc32(data)
    const { time, date } = dosDateTime(statSync(file).mtime)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0) // signature
    local.writeUInt16LE(20, 4) // version requise
    local.writeUInt16LE(0x0800, 6) // noms en UTF-8
    local.writeUInt16LE(8, 8) // deflate
    local.writeUInt16LE(time, 10)
    local.writeUInt16LE(date, 12)
    local.writeUInt32LE(checksum, 14)
    local.writeUInt32LE(compressed.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(name.length, 26)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0) // signature
    central.writeUInt16LE((3 << 8) | 20, 4) // créé sous Unix : les permissions ci-dessous sont lues
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(8, 10)
    central.writeUInt16LE(time, 12)
    central.writeUInt16LE(date, 14)
    central.writeUInt32LE(checksum, 16)
    central.writeUInt32LE(compressed.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(0o100644 * 0x10000, 38) // fichier ordinaire, rw-r--r--
    central.writeUInt32LE(offset, 42)

    locals.push(local, name, compressed)
    centrals.push(central, name)
    offset += local.length + name.length + compressed.length
  }

  if (files.length > 0xffff || offset > 0xffffffff) {
    fail('Archive trop volumineuse pour le format ZIP simple (ZIP64 non géré).')
  }

  const directory = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0) // signature
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)

  return Buffer.concat([...locals, directory, end])
}

function packageRelease(version) {
  mkdirSync(DIST, { recursive: true })

  const files = listFiles(STAGING).sort()
  const zip = createZip(files, STAGING, 'yawasla')
  const zipName = RELEASE ? `yawasla-${version}.zip` : 'yawasla-dev.zip'

  writeFileSync(join(DIST, zipName), zip)

  console.log(`  ${files.length} fichiers, ${(zip.length / 1024 / 1024).toFixed(2)} Mo`)
  console.log(`  dist/${zipName}`)

  // Aussi pour le build dev : permet de tester la mise à jour automatique sans commiter. Archive et
  // version.json toujours générés ensemble, sinon l'empreinte publiée ne correspond plus à l'archive
  const hash = createHash('sha256').update(zip).digest('hex')
  writeFileSync(join(DIST, `${zipName}.sha256`), `${hash}  ${zipName}\n`)
  console.log(`  SHA-256 : ${hash}`)

  // Lu par les installations pour se mettre à jour (Yawasla\Core\Updater) : à publier à côté de
  // l'archive, sur le serveur de distribution. URL relative, résolue par rapport à version.json
  const manifest = {
    version,
    date: new Date().toISOString().slice(0, 10),
    php: readPhpRequirement(),
    url: zipName,
    sha256: hash,
  }
  writeFileSync(join(DIST, 'version.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  console.log('  dist/version.json')
}

const version = readVersion()
console.log(`Yawasla ${version}${RELEASE ? '' : ' (build de développeur)'}`)

step('Outils')
checkTools()

step('Dépôt git')
checkGit()

step('Front : dépendances et compilation')
buildFront()

step('Assemblage')
assemble()

step('Back : dépendances de production')
installBackDependencies()

removeBuildFiles()

step('Vérification PHP')
lintPhp()

step('Archive')
packageRelease(version)
rmSync(STAGING_ROOT, { recursive: true, force: true })

console.log('\n✓ Distribution prête')
