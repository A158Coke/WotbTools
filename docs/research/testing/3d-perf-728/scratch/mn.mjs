import net from 'node:net'
export class Marionette {
  constructor(port = 2828) { this.port = port; this.id = 0; this.buf = Buffer.alloc(0); this.pending = new Map() }
  connect() {
    return new Promise((res, rej) => {
      this.sock = net.connect(this.port, '127.0.0.1')
      let first = true
      this.sock.on('data', (d) => {
        this.buf = Buffer.concat([this.buf, d])
        for (;;) {
          const s = this.buf.toString('utf8', 0, Math.min(this.buf.length, 12)); const i = s.indexOf(':'); if (i < 0) return
          const len = Number(s.slice(0, i)); const start = i + 1
          if (this.buf.length < start + len) return
          const msg = JSON.parse(this.buf.slice(start, start + len).toString('utf8')); this.buf = this.buf.slice(start + len)
          if (first) { first = false; res(msg); continue }
          const p = this.pending.get(msg[1]); if (p) { this.pending.delete(msg[1]); msg[2] ? p.rej(new Error(JSON.stringify(msg[2]))) : p.res(msg[3]) }
        }
      })
      this.sock.on('error', rej)
    })
  }
  send(cmd, params = {}) {
    const id = ++this.id; const body = JSON.stringify([0, id, cmd, params])
    return new Promise((res, rej) => { this.pending.set(id, { res, rej }); this.sock.write(Buffer.byteLength(body) + ':' + body) })
  }
  exec(script, args = []) { return this.send('WebDriver:ExecuteScript', { script, args, sandbox: 'default' }) }
  execAsync(script, args = [], timeout) { return this.send('WebDriver:ExecuteAsyncScript', { script, args }) }
  close() { this.sock.destroy() }
}
