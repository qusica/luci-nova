'use strict';
const { spawn } = require('node:child_process');
const path = require('node:path');
function chromium(directory) {
    const child = spawn(process.env.CHROME_BIN || 'google-chrome', [
        '--headless', '--no-sandbox', '--disable-dev-shm-usage', '--no-first-run',
        '--no-default-browser-check', '--disable-background-networking',
        '--remote-debugging-pipe', '--user-data-dir=' + path.join(directory, 'profile'),
        'about:blank'
    ], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
    let sequence = 0, buffer = '', stderr = '', failure;
    const pending = new Map();
    const fail = error => {
        failure = new Error(error.message + '\nChrome stderr: ' + stderr); error = failure;
        for (const request of pending.values()) {
            clearTimeout(request.timer);
            request.reject(error);
        }
        pending.clear();
    };
    child.stderr.on('data', data => { stderr = (stderr + data).slice(-16000); });
    child.on('error', fail);
    child.stdio[3].on('error', fail);
    child.stdio[4].on('error', fail);
    child.on('exit', (code, signal) => fail(new Error(`Chrome exited (${code}, ${signal}): ${stderr}`)));
    child.stdio[4].setEncoding('utf8');
    child.stdio[4].on('data', data => {
        buffer += data;
        let end;
        while ((end = buffer.indexOf('\0')) !== -1) {
            const packet = buffer.slice(0, end);
            buffer = buffer.slice(end + 1);
            if (!packet) continue;
            const message = JSON.parse(packet);
            const request = pending.get(message.id);
            if (!request) continue;
            pending.delete(message.id);
            clearTimeout(request.timer);
            if (message.error) request.reject(new Error(JSON.stringify(message.error)));
            else request.resolve(message.result);
        }
    });
    function send(method, params = {}, sessionId) {
        if (failure) return Promise.reject(failure);
        const id = ++sequence;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                pending.delete(id);
                reject(new Error(`CDP timed out: ${method}\n${stderr}`));
            }, 10000);
            pending.set(id, { resolve, reject, timer });
            child.stdio[3].write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0');
        });
    }
    async function close() {
        if (child.exitCode !== null || child.signalCode !== null) return;
        const exited = new Promise(resolve => child.once('exit', resolve));
        child.kill('SIGTERM');
        const timer = setTimeout(() => child.kill('SIGKILL'), 2000);
        await exited;
        clearTimeout(timer);
    }
    return { send, close };
}

module.exports = chromium;
