import { spawn } from 'node:child_process';
const children = [spawn(process.execPath, ['--watch', 'backend/server.js'], { stdio: 'inherit' }), spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1'], { stdio: 'inherit' })];
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { children.forEach(child => child.kill()); process.exit(); });
children.forEach(child => child.on('exit', code => { if (code) { children.forEach(other => other.kill()); process.exit(code); } }));
