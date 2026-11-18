import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const BASE = process.env.BASE_SHA;
if (!BASE || !/^[0-9a-f]{40}$/.test(BASE)) {
    throw new Error('BASE_SHA must be a commit SHA');
}

const OUTPUT = execFileSync(
    'git',
    ['diff', '--name-only', '-z', '--diff-filter=ACMR', BASE + '...HEAD'],
    { encoding: 'utf8' },
);
const CHANGED = OUTPUT.split('\0')
    .filter(Boolean)
    .filter((file) => existsSync(file));
const PRETTIER = CHANGED.filter((file) => /\.(js|mjs|cjs|html?|css|json|md|markdown)$/i.test(file));
const ESLINT = CHANGED.filter((file) => /\.(js|mjs|cjs|html?)$/i.test(file));

function check(command, args) {
    if (args.length === 0) {
        return;
    }
    execFileSync('npm', ['exec', '--', command, ...args], { stdio: 'inherit' });
}
check('prettier', PRETTIER.length ? ['--check', '--ignore-unknown', ...PRETTIER] : []);
check('eslint', ESLINT.length ? ['--no-warn-ignored', ...ESLINT] : []);
console.log('Changed files: ' + CHANGED.length);
