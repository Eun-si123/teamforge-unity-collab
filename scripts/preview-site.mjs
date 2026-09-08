/** Serve the built static Pages tree locally, preserving production metadata.
 * npm run dev -- --host 0.0.0.0 --port 4173 --strictPort
 */
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const root = resolve('.pages-site');
const host = option('--host', '127.0.0.1');
const port = Number(option('--port', '4173'));
const types = {'.html':'text/html', '.css':'text/css', '.js':'text/javascript', '.json':'application/json', '.txt':'text/plain', '.md':'text/plain', '.xml':'application/xml', '.mp4':'video/mp4', '.webm':'video/webm', '.jpg':'image/jpeg', '.gif':'image/gif', '.svg':'image/svg+xml'};
await stat(resolve(root, 'index.html'));
http.createServer(async (req,res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const path = decodeURIComponent(url.pathname).replace(/^\/teamforge-unity-collab\//, '/');
    let file = resolve(root, '.' + path);
    if (file !== root && !file.startsWith(root + sep)) { res.writeHead(403).end(); return; }
    if ((await stat(file)).isDirectory()) file = resolve(file, 'index.html');
    let bytes = await readFile(file);
    const type = types[extname(file)] || 'application/octet-stream';
    // Only the local preview response is rewritten. Build output retains canonical URLs.
    if (/text\/|json|xml/.test(type)) bytes = Buffer.from(bytes.toString().replaceAll('https://eun-si123.github.io/teamforge-unity-collab/', '/'));
    res.writeHead(200, {'Content-Type':type,'Content-Length':bytes.length,'Cache-Control':'no-store'}).end(bytes);
  } catch { res.writeHead(404,{'Content-Type':'text/plain'}).end('Not found'); }
}).listen(port,host,()=>console.log(`Static Pages preview listening on ${port}`));
