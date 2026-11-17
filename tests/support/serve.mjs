// The static origin model for the noise.dog harness: which repo file answers a request path.
//
// Production is a bare nginx serving the repo root (/var/www/noise.dog). Observed on
// https://noise.dog on 2026-11-17 (LIF-938 intake, curl):
//   /images            -> 301 (nginx adds the trailing slash to a directory)
//   /images/           -> 403 (a directory with no index file)
//   /brown-noise.html  -> 200, byte-identical to / (no file of that name exists; the fallback answers)
//   /nonexistent-xyz   -> 200, byte-identical to / (unknown paths fall back to index.html)
//   /robots.txt        -> 200 text/plain (a real file is served as itself)
//
// This module encodes that behaviour, plus ONE deliberate addition (rule 4): a request for /<name>
// is answered by <name>.html when that file exists. That is the standard one-line nginx change
// (`try_files $uri $uri.html $uri/ /index.html`) and it is what makes a distinct /brown-noise
// document possible at all, because today's fallback can only ever answer with index.html. The
// implementer owns delivering it on the host through the existing deploy mechanics; the live
// response-identity check (AC5) is the stage that proves the host does it. See the LIF-938
// tests-ready hand-off.
//
// Rules, in order, for a GET of `pathname`:
//   1. A real file under the repo root                -> 200, Content-Type from its extension
//      (an extensionless file gets nginx's default application/octet-stream: a browser would
//      download it, so it cannot be a page).
//   2. <pathname>.html                                -> 200 text/html
//   3. A directory: no trailing slash                 -> 301 to <pathname>/ (observed nginx)
//                    trailing slash + index.html      -> 200 that index.html
//                    trailing slash, no index.html    -> 403 (observed nginx)
//   4. anything else                                  -> 200 index.html (observed fallback)
// tests/, node_modules/ and .git/ are never served (they are not deployed).

import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.xml': 'application/xml',
  '.txt': 'text/plain; charset=utf-8',
  '.js': 'application/javascript',
  '.json': 'application/json',
};

const isDeployed = (rel) => !(rel.startsWith('tests/') || rel.startsWith('node_modules/') || rel.startsWith('.git/') || rel === '.git');

async function fileAt(rel) {
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT + path.sep)) return null;
  try {
    const s = await stat(file);
    return s.isFile() ? file : null;
  } catch {
    return null;
  }
}

async function dirExists(rel) {
  const dir = path.join(ROOT, rel);
  if (!dir.startsWith(ROOT + path.sep)) return false;
  try {
    return (await stat(dir)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Answer a request path the way production's nginx would.
 * @returns {{ status: number, body?: Buffer, contentType?: string, location?: string, servedFrom?: string }}
 */
export async function respond(pathname, { fallbackBody = null } = {}) {
  let rel;
  try {
    rel = decodeURIComponent(pathname).replace(/^\/+/, '');
  } catch {
    return { status: 400 };
  }
  const homepage = async () => ({
    status: 200,
    body: fallbackBody ?? await readFile(path.join(ROOT, 'index.html')),
    contentType: CONTENT_TYPES['.html'],
    servedFrom: 'index.html',
  });
  if (rel === '') return homepage();
  if (!isDeployed(rel)) return { status: 404, body: Buffer.from('not found'), contentType: 'text/plain' };

  const exact = rel.endsWith('/') ? null : await fileAt(rel);
  if (exact) {
    const ext = path.extname(exact);
    return {
      status: 200,
      body: await readFile(exact),
      contentType: CONTENT_TYPES[ext] || 'application/octet-stream',
      servedFrom: path.relative(ROOT, exact),
    };
  }
  const html = rel.endsWith('/') ? null : await fileAt(`${rel}.html`);
  if (html) {
    return { status: 200, body: await readFile(html), contentType: CONTENT_TYPES['.html'], servedFrom: path.relative(ROOT, html) };
  }
  if (await dirExists(rel)) {
    if (!rel.endsWith('/')) return { status: 301, location: `/${rel}/` };
    const index = await fileAt(path.join(rel, 'index.html'));
    if (!index) return { status: 403, body: Buffer.from('forbidden'), contentType: 'text/html' };
    return { status: 200, body: await readFile(index), contentType: CONTENT_TYPES['.html'], servedFrom: path.relative(ROOT, index) };
  }
  return homepage();
}
