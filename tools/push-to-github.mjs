/**
 * 一次性：创建私有仓库并推送。
 *
 * 密钥处理原则 —— token 全程不落盘、不进日志、不进 git 配置：
 *   1. 从 tokenFile 读（该文件在 .gitignore 之外，用完即删）。
 *   2. 调 GitHub API 时只放 Authorization 头。
 *   3. git push 用临时 credential helper 从文件读，绝不把 token 写进 remote URL
 *      （写进去会留在 .git/config 与 reflog 里）。
 *   4. 任何输出都不回显 token。
 */
import fs from 'node:fs';
import net from 'node:net';
import tls from 'node:tls';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const TOOLS_DIR = import.meta.dirname;
const REPO_DIR = path.resolve(TOOLS_DIR, '..');
const TOKEN_FILE = path.join(TOOLS_DIR, '.gh_token');
const REPO_NAME = 'corti-soul';
const PRIVATE = true;

const PROXY = { host: '127.0.0.1', port: 7897 };
const API = 'api.github.com';

if (!fs.existsSync(TOKEN_FILE)) {
  console.error(`缺少 token 文件：${TOKEN_FILE}`);
  process.exit(1);
}
const TOKEN = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
if (!TOKEN) { console.error('token 文件为空'); process.exit(1); }
console.log(`已读取 token（长度 ${TOKEN.length}，${TOKEN.slice(0, 4)}…${TOKEN.slice(-2)}）`);

/** 经代理发一次 HTTP 请求，返回 {status, body}。 */
function api(method, urlPath, payload) {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host: PROXY.host, port: PROXY.port }, () => {
      sock.write(`CONNECT ${API}:443 HTTP/1.1\r\nHost: ${API}:443\r\n\r\n`);
    });
    sock.once('data', (buf) => {
      if (!/200/.test(buf.toString('latin1').split('\r\n')[0])) {
        return reject(new Error('代理隧道建立失败'));
      }
      const t = tls.connect({ socket: sock, servername: API }, () => {
        const body = payload ? JSON.stringify(payload) : '';
        const head = [
          `${method} ${urlPath} HTTP/1.1`,
          `Host: ${API}`,
          'User-Agent: corti-soul-push',
          'Accept: application/vnd.github+json',
          'X-GitHub-Api-Version: 2022-11-28',
          `Authorization: Bearer ${TOKEN}`,
          body ? 'Content-Type: application/json' : null,
          body ? `Content-Length: ${Buffer.byteLength(body)}` : null,
          'Connection: close',
          '', '',
        ].filter(x => x !== null).join('\r\n');
        t.write(head + body);
      });
      let raw = '';
      t.on('data', d => raw += d.toString('utf8'));
      t.on('end', () => {
        const idx = raw.indexOf('\r\n\r\n');
        const head = raw.slice(0, idx);
        const status = parseInt(head.split('\r\n')[0].split(' ')[1], 10);
        let text = raw.slice(idx + 4);
        // 处理 chunked
        if (/transfer-encoding:\s*chunked/i.test(head)) {
          let out = '', p = 0;
          while (p < text.length) {
            const nl = text.indexOf('\r\n', p);
            if (nl < 0) break;
            const size = parseInt(text.slice(p, nl), 16);
            if (!size) break;
            out += text.slice(nl + 2, nl + 2 + size);
            p = nl + 2 + size + 2;
          }
          text = out;
        }
        resolve({ status, body: text });
      });
      t.on('error', reject);
    });
    sock.on('error', reject);
  });
}

const j = (s) => { try { return JSON.parse(s); } catch { return null; } };

// 1) 确认身份
const me = await api('GET', '/user');
if (me.status !== 200) {
  console.error(`认证失败 (HTTP ${me.status})：${me.body.slice(0, 200)}`);
  process.exit(1);
}
const LOGIN = j(me.body)?.login;
console.log(`认证成功，账号：${LOGIN}`);

// 2) 创建仓库（已存在则复用）
const created = await api('POST', '/user/repos', {
  name: REPO_NAME,
  private: PRIVATE,
  description: 'Cortico QQ 人格栈：扩展补丁、上游配额守护与桌面启动器',
  has_issues: true, has_wiki: false, auto_init: false,
});
if (created.status === 201) {
  console.log(`仓库已创建：${j(created.body)?.full_name}（${PRIVATE ? '私有' : '公开'}）`);
} else if (created.status === 422) {
  console.log(`仓库已存在，复用 ${LOGIN}/${REPO_NAME}`);
} else {
  console.error(`创建仓库失败 (HTTP ${created.status})：${created.body.slice(0, 300)}`);
  process.exit(1);
}

// 3) 配置 remote（干净 URL，不含 token）
const REMOTE = `https://github.com/${LOGIN}/${REPO_NAME}.git`;
const g = (...args) => execFileSync('git', args, { cwd: REPO_DIR, encoding: 'utf8' }).trim();
try { g('remote', 'remove', 'origin'); } catch {}
g('remote', 'add', 'origin', REMOTE);
console.log(`remote origin → ${REMOTE}`);

// 4) 推送：临时 credential helper 从环境变量读，token 不进 config、不进文件路径
//    （路径含中文，走 shell 的 cat 不可靠；环境变量最稳）
//    先 `credential.helper=` 清空系统级 helper：本机 system config 里配了
//    Git Credential Manager，它会抢先喂一条陈旧的 github 凭据，导致
//    "Write access to repository not granted" + 403。
const helper = '!f() { echo username=x-access-token; echo "password=$DSH_GH_TOKEN"; }; f';
console.log('正在推送…');
try {
  const out = execFileSync('git',
    ['-c', 'credential.helper=', '-c', `credential.helper=${helper}`,
     'push', '-u', 'origin', 'HEAD'],
    {
      cwd: REPO_DIR, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, DSH_GH_TOKEN: TOKEN },
    });
  console.log(out.trim() || '推送完成');
} catch (e) {
  const msg = `${e.stderr ?? ''}${e.stdout ?? ''}`.replace(TOKEN, '***');
  console.error('推送失败：', msg.slice(0, 500));
  process.exit(1);
}

// 5) 只保留干净 remote，复查 config 里没有 token
const cfg = fs.readFileSync(path.join(REPO_DIR, '.git', 'config'), 'utf8');
console.log(cfg.includes(TOKEN) ? '⚠ .git/config 里出现了 token，需清理' : '✓ .git/config 不含 token');
console.log(`\n完成：${REMOTE}`);
