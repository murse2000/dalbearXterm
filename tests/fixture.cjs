const { Server, utils } = require('ssh2');
const { generateKeyPairSync, createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { STATUS_CODE } = utils.sftp;

// 실제 SSH 전송 계층과 SFTP 요청을 검증하는 로컬 테스트 서버다.
async function createFixture(root, options = {}) {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs1', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
  const clients = new Set();
  const server = new Server({ hostKeys: [privateKey] }, client => {
    clients.add(client); client.on('error', () => {}); client.on('close', () => clients.delete(client));
    client.on('authentication', context => context.username === 'tester' && context.method === 'password' && context.password === 'test-fixture-password' ? context.accept() : context.reject());
    client.on('ready', () => client.on('session', accept => {
      const session = accept();
      session.on('pty', accept => accept());
      session.on('window-change', accept => accept?.());
      session.on('shell', accept => {
        const channel = accept();
        if (options.onShell) { options.onShell(channel); return; }
        channel.write('SSH 테스트 연결\r\n');
        channel.on('data', bytes => channel.write(Buffer.concat([Buffer.from('수신: '), bytes])));
      });
      session.on('sftp', accept => {
        const stream = accept();
        const handles = new Map(); let nextHandle = 0;
        const local = remote => {
          const resolved = path.resolve(root, `.${remote.startsWith('/') ? remote : '/' + remote}`);
          if (resolved !== root && !resolved.startsWith(root + path.sep)) throw new Error('테스트 경로 범위 초과');
          return resolved;
        };
        const replyError = (request, error) => stream.status(request, error?.code === 'ENOENT' ? STATUS_CODE.NO_SUCH_FILE : STATUS_CODE.FAILURE);
        const wrap = callback => (request, ...args) => { try { callback(request, ...args); } catch (error) { replyError(request, error); } };
        const attrs = file => { const stats = fs.statSync(file); return { mode: stats.mode, uid: 0, gid: 0, size: stats.size, atime: Math.floor(stats.atimeMs / 1000), mtime: Math.floor(stats.mtimeMs / 1000) }; };
        stream.on('REALPATH', wrap((request, remote) => {
          const file = fs.realpathSync(local(remote)); const relative = '/' + path.relative(root, file).replaceAll('\\', '/');
          stream.name(request, [{ filename: relative, longname: relative, attrs: attrs(file) }]);
        }));
        for (const event of ['STAT', 'LSTAT']) stream.on(event, wrap((request, remote) => stream.attrs(request, attrs(local(remote)))));
        stream.on('OPENDIR', wrap((request, remote) => { const handle = Buffer.alloc(4); handle.writeUInt32BE(++nextHandle); handles.set(nextHandle, { names: fs.readdirSync(local(remote)), directory: local(remote), sent: false }); stream.handle(request, handle); }));
        stream.on('READDIR', wrap((request, handle) => { const entry = handles.get(handle.readUInt32BE()); if (entry.sent) stream.status(request, STATUS_CODE.EOF); else { entry.sent = true; stream.name(request, entry.names.map(name => ({ filename: name, longname: name, attrs: attrs(path.join(entry.directory, name)) }))); } }));
        stream.on('OPEN', wrap((request, remote, flags) => { const handle = Buffer.alloc(4); handle.writeUInt32BE(++nextHandle); const fd = fs.openSync(local(remote), utils.sftp.flagsToString(flags)); handles.set(nextHandle, { fd }); stream.handle(request, handle); }));
        stream.on('FSTAT', wrap((request, handle) => { const entry = handles.get(handle.readUInt32BE()); const stats = fs.fstatSync(entry.fd); stream.attrs(request, { mode: stats.mode, uid: 0, gid: 0, size: stats.size, atime: 0, mtime: 0 }); }));
        stream.on('READ', wrap((request, handle, offset, length) => { const data = Buffer.alloc(Math.min(length, 32768)); const count = fs.readSync(handles.get(handle.readUInt32BE()).fd, data, 0, data.length, offset); if (count) stream.data(request, data.subarray(0, count)); else stream.status(request, STATUS_CODE.EOF); }));
        stream.on('WRITE', wrap((request, handle, offset, data) => { fs.writeSync(handles.get(handle.readUInt32BE()).fd, data, 0, data.length, offset); stream.status(request, STATUS_CODE.OK); }));
        stream.on('CLOSE', wrap((request, handle) => { const key = handle.readUInt32BE(); const entry = handles.get(key); if (entry?.fd !== undefined) fs.closeSync(entry.fd); handles.delete(key); stream.status(request, STATUS_CODE.OK); }));
        stream.on('RENAME', wrap((request, oldPath, newPath) => { if (fs.existsSync(local(newPath))) return stream.status(request, STATUS_CODE.FAILURE); fs.renameSync(local(oldPath), local(newPath)); stream.status(request, STATUS_CODE.OK); }));
        stream.on('REMOVE', wrap((request, remote) => { fs.unlinkSync(local(remote)); stream.status(request, STATUS_CODE.OK); }));
        stream.on('EXTENDED', wrap((request, name, data) => {
          if (name !== 'posix-rename@openssh.com') return stream.status(request, STATUS_CODE.OP_UNSUPPORTED);
          const length = data.readUInt32BE(0); const oldPath = data.subarray(4, 4 + length).toString(); const newLength = data.readUInt32BE(4 + length); const newPath = data.subarray(8 + length, 8 + length + newLength).toString();
          fs.renameSync(local(oldPath), local(newPath)); stream.status(request, STATUS_CODE.OK);
        }));
        stream.on('close', () => { for (const entry of handles.values()) if (entry.fd !== undefined) { try { fs.closeSync(entry.fd); } catch {} } });
      });
    }));
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const fingerprint = `SHA256:${createHash('sha256').update(utils.parseKey(privateKey).getPublicSSH()).digest('base64').replace(/=+$/, '')}`;
  return { port: server.address().port, fingerprint, close: async () => { for (const client of clients) client.end(); await new Promise(resolve => server.close(resolve)); } };
}
module.exports = { createFixture };
