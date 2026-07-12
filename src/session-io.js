#!/usr/bin/env node
/**
 * session-io — export a Claude Code session on one machine and import it on another
 * so it can be resumed with `claude --resume <id>`.
 *
 * This is a standalone CLI: it reads/writes ~/.claude directly and does NOT need
 * the explorer web server running. Copy this repo (or just this file plus
 * session-sharing.js) to the target laptop to import.
 *
 * Usage:
 *   node src/session-io.js list
 *       List local sessions (id, project, path).
 *
 *   node src/session-io.js export <session-id | path/to/session.jsonl> [-o out.ccsession.json]
 *       Export a session losslessly to a portable .ccsession.json package.
 *
 *   node src/session-io.js import <file.ccsession.json | path/to/session.jsonl> [options]
 *       Install a package into ~/.claude so it can be resumed on THIS machine.
 *       Options:
 *         --cwd <path>   Repo path on this machine to attach the session to
 *                        (default: current working directory)
 *         --keep-id      Keep the original session id (default: mint a fresh one)
 *         --force        Overwrite if a session with the target id already exists
 *
 *   node src/session-io.js export-all [-o bundle.ccbundle.json]
 *       Export EVERY local session into one portable bundle (whole-history transfer).
 *
 *   node src/session-io.js import-all <bundle.ccbundle.json> [options]
 *       Install every session from a bundle onto THIS machine at their original paths.
 *       Options:
 *         --map <from=to>  Remap a cwd path prefix (e.g. /Users/old=/Users/new)
 *         --fresh-ids      Mint new session ids (default: preserve original ids)
 *         --force          Overwrite existing transcripts
 */

const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const chalk = require('chalk');
const SessionSharing = require('./session-sharing');

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--keep-id') args.keepId = true;
    else if (a === '--force') args.force = true;
    else if (a === '--fresh-ids') args.freshIds = true;
    else if (a === '--cwd') args.cwd = argv[++i];
    else if (a === '--map') args.map = argv[++i];
    else if (a === '-o' || a === '--out') args.out = argv[++i];
    else args._.push(a);
  }
  return args;
}

async function listSessions() {
  const projectsRoot = path.join(os.homedir(), '.claude', 'projects');
  if (!(await fs.pathExists(projectsRoot))) {
    console.log(chalk.yellow('No ~/.claude/projects directory found.'));
    return;
  }
  const dirs = await fs.readdir(projectsRoot);
  const rows = [];
  for (const dir of dirs) {
    const dirPath = path.join(projectsRoot, dir);
    const stat = await fs.stat(dirPath).catch(() => null);
    if (!stat || !stat.isDirectory()) continue;
    for (const file of await fs.readdir(dirPath)) {
      if (!file.endsWith('.jsonl')) continue;
      const full = path.join(dirPath, file);
      let cwd = '';
      try {
        // read the first line that carries a cwd
        const head = (await fs.readFile(full, 'utf8')).split('\n').slice(0, 20);
        for (const line of head) {
          if (!line.trim()) continue;
          try {
            const obj = JSON.parse(line);
            if (obj.cwd) { cwd = obj.cwd; break; }
          } catch { /* ignore */ }
        }
      } catch { /* ignore */ }
      rows.push({ id: path.basename(file, '.jsonl'), cwd, path: full });
    }
  }
  if (rows.length === 0) {
    console.log(chalk.yellow('No sessions found.'));
    return;
  }
  console.log(chalk.bold(`\nFound ${rows.length} session(s):\n`));
  for (const r of rows) {
    console.log(chalk.cyan(r.id));
    console.log(chalk.gray(`   cwd:  ${r.cwd || '(unknown)'}`));
    console.log(chalk.gray(`   file: ${r.path}\n`));
  }
}

async function exportSession(args) {
  const target = args._[0];
  if (!target) {
    console.error(chalk.red('Usage: session-io export <session-id | path/to/session.jsonl> [-o out.json]'));
    process.exit(1);
  }
  const sharing = new SessionSharing(null);

  const isPath = target.endsWith('.jsonl') || target.includes(path.sep);
  const pkg = await sharing.exportSessionRaw(
    isPath ? { filePath: path.resolve(target) } : { sessionId: target }
  );

  const outName = args.out
    || `claude-session-${(pkg.source.project || 'session').replace(/[^a-zA-Z0-9-_]/g, '-')}-${pkg.source.sessionId.slice(0, 8)}.ccsession.json`;
  const outPath = path.resolve(outName);
  await fs.writeFile(outPath, JSON.stringify(pkg, null, 2), 'utf8');

  console.log(chalk.green(`✅ Exported ${pkg.source.lineCount} event(s)`));
  if (pkg.sidechains.length) {
    console.log(chalk.gray(`   + ${pkg.sidechains.length} subagent transcript(s)`));
  }
  console.log(chalk.gray(`   source cwd: ${pkg.source.cwd || '(unknown)'}`));
  console.log(chalk.cyan(`📦 ${outPath}`));
  console.log(chalk.yellow('\nCopy this file to the other machine, then run:'));
  console.log(chalk.white(`   node src/session-io.js import ${path.basename(outPath)} --cwd /path/to/repo\n`));
}

async function importSession(args) {
  const file = args._[0];
  if (!file) {
    console.error(chalk.red('Usage: session-io import <file.ccsession.json | session.jsonl> [--cwd <path>] [--keep-id] [--force]'));
    process.exit(1);
  }
  const filePath = path.resolve(file);
  if (!(await fs.pathExists(filePath))) {
    console.error(chalk.red(`File not found: ${filePath}`));
    process.exit(1);
  }

  const sharing = new SessionSharing(null);

  // Accept either our package format or a bare .jsonl transcript.
  let pkg;
  if (filePath.endsWith('.jsonl')) {
    pkg = await sharing.exportSessionRaw({ filePath });
  } else {
    pkg = JSON.parse(await fs.readFile(filePath, 'utf8'));
    if (!Array.isArray(pkg.lines)) {
      console.error(chalk.red('Not a valid session package (missing "lines"). Pass a .ccsession.json or a .jsonl transcript.'));
      process.exit(1);
    }
  }

  const targetCwd = path.resolve(args.cwd || process.cwd());
  const result = await sharing.importSession(pkg, {
    targetCwd,
    keepSessionId: !!args.keepId,
    force: !!args.force
  });

  console.log(chalk.green(`\n✅ Imported ${result.lineCount} event(s)`));
  if (result.sidechainCount) {
    console.log(chalk.gray(`   + ${result.sidechainCount} subagent transcript(s)`));
  }
  console.log(chalk.gray(`   transcript: ${result.sessionFile}`));
  if (result.originalSessionId && result.originalSessionId !== result.sessionId) {
    console.log(chalk.gray(`   session id: ${result.originalSessionId} → ${result.sessionId} (fresh)`));
  }
  console.log(chalk.yellow(`\n💡 To continue this conversation on this machine:`));
  console.log(chalk.white(`\n   cd ${result.targetCwd}`));
  console.log(chalk.white(`   claude --resume ${result.sessionId}\n`));
  console.log(chalk.gray('   (or just open Claude Code in that repo and pick it from the session list)'));
}

async function exportAll(args) {
  const sharing = new SessionSharing(null);
  console.log(chalk.gray('Scanning ~/.claude/projects ...'));
  const bundle = await sharing.exportAllSessions();

  const outName = args.out || `claude-sessions-bundle-${new Date().toISOString().split('T')[0]}.ccbundle.json`;
  const outPath = path.resolve(outName);
  await fs.writeFile(outPath, JSON.stringify(bundle), 'utf8');

  console.log(chalk.green(`✅ Bundled ${bundle.sessionCount} session(s)`));
  if (bundle.errors.length) {
    console.log(chalk.yellow(`   ⚠️  ${bundle.errors.length} file(s) could not be read`));
  }
  console.log(chalk.cyan(`📦 ${outPath}`));
  console.log(chalk.yellow('\nCopy this file to the other machine, then run:'));
  console.log(chalk.white(`   node src/session-io.js import-all ${path.basename(outPath)}\n`));
}

async function importAll(args) {
  const file = args._[0];
  if (!file) {
    console.error(chalk.red('Usage: session-io import-all <bundle.ccbundle.json> [--map from=to] [--fresh-ids] [--force]'));
    process.exit(1);
  }
  const filePath = path.resolve(file);
  if (!(await fs.pathExists(filePath))) {
    console.error(chalk.red(`File not found: ${filePath}`));
    process.exit(1);
  }

  const bundle = JSON.parse(await fs.readFile(filePath, 'utf8'));
  if (!Array.isArray(bundle.sessions)) {
    console.error(chalk.red('Not a valid bundle (missing "sessions"). Use "import" for a single .ccsession.json.'));
    process.exit(1);
  }

  let pathMap;
  if (args.map) {
    const [from, to] = args.map.split('=');
    if (!from || !to) {
      console.error(chalk.red('--map must be in the form from=to (e.g. /Users/old=/Users/new)'));
      process.exit(1);
    }
    pathMap = { from, to };
  }

  const sharing = new SessionSharing(null);
  const result = await sharing.importBundle(bundle, {
    keepSessionId: !args.freshIds,
    force: !!args.force,
    pathMap
  });

  console.log(chalk.green(`\n✅ Imported ${result.imported} of ${result.total} session(s)`));
  if (result.skipped) {
    console.log(chalk.yellow(`   ⚠️  Skipped ${result.skipped}:`));
    for (const r of result.results.filter(r => r.skipped)) {
      console.log(chalk.gray(`      ${r.sessionId || '(unknown)'} — ${r.reason}`));
    }
  }
  console.log(chalk.gray('\nOpen Claude Code in the relevant repos and pick sessions from the list, or use `claude --resume <id>`.'));
}

async function main() {
  const argv = process.argv.slice(2);
  const command = argv[0];
  const args = parseArgs(argv.slice(1));

  try {
    switch (command) {
      case 'list':
        await listSessions();
        break;
      case 'export':
        await exportSession(args);
        break;
      case 'import':
        await importSession(args);
        break;
      case 'export-all':
        await exportAll(args);
        break;
      case 'import-all':
        await importAll(args);
        break;
      default:
        console.log(chalk.bold('session-io — portable Claude Code sessions\n'));
        console.log('Commands:');
        console.log('  list                                   List local sessions');
        console.log('  export <id|file.jsonl> [-o out.json]   Export a session to a portable package');
        console.log('  import <file> [--cwd <path>] [--keep-id] [--force]');
        console.log('                                         Install a package so it can be resumed here');
        console.log('  export-all [-o bundle.json]            Export ALL sessions into one transfer bundle');
        console.log('  import-all <bundle.json> [--map from=to] [--fresh-ids] [--force]');
        console.log('                                         Install every session from a bundle');
        process.exit(command ? 1 : 0);
    }
  } catch (err) {
    console.error(chalk.red(`\n❌ ${err.message}`));
    process.exit(1);
  }
}

main();
