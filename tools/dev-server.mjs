import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const TYPES = new Map([
    ['.html', 'text/html; charset=utf-8'],
    ['.mjs', 'text/javascript; charset=utf-8'],
    ['.css', 'text/css; charset=utf-8'],
]);
const PORT = Number(process.env.PORT ?? 4173);

createServer(async (request, response) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.writeHead(405, { Allow: 'GET, HEAD' }).end();
        return;
    }
    let pathname;
    try {
        pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    } catch {
        response.writeHead(400).end();
        return;
    }
    if (pathname === '/') {
        pathname = '/index.html';
    }
    const FILE = resolve(ROOT, '.' + pathname);
    const TYPE = TYPES.get(extname(FILE));
    if (
        !FILE.startsWith(ROOT) ||
        !TYPE ||
        (pathname !== '/index.html' &&
            !['src', 'styles'].some((dir) => FILE.startsWith(ROOT + dir + sep)))
    ) {
        response.writeHead(404).end();
        return;
    }
    let info;
    try {
        info = await stat(FILE);
    } catch (error) {
        if (error.code === 'ENOENT' || error.code === 'ENOTDIR') {
            response.writeHead(404).end();
            return;
        }
        throw error;
    }
    if (!info.isFile()) {
        response.writeHead(404).end();
        return;
    }
    response.writeHead(200, {
        'Content-Type': TYPE,
        'Content-Length': info.size,
        'Cache-Control': 'no-store',
    });
    if (request.method === 'HEAD') {
        response.end();
    } else {
        createReadStream(FILE).pipe(response);
    }
}).listen(PORT, '127.0.0.1', () => {
    console.log(`Duck Bowling: http://127.0.0.1:${PORT}/`);
});
