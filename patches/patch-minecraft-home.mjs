/** 安装MC住宅模块，预检全部锚点后写入；重复执行只同步自有文件。 */
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const target = path.resolve(process.env.CORTICO_ROOT ?? path.join(root, '..', 'cortico-qq'));
const mc = path.join(target, 'src/worlds/minecraft');
const flags = process.argv.slice(2);
if (flags.some((f) => f !== '--check')) { console.error('只支持--check；升级回滚请使用版本控制，不覆盖旧备份'); process.exit(2); }
const check = flags.includes('--check');
const changes = [];
function edit(file, marker, anchor, replacement) {
  let item = changes.find((i) => i.file === file);
  if (!item) { const original = fs.readFileSync(file, 'utf8'); item = { file, original, text: original }; changes.push(item); }
  if (item.text.includes(marker)) return;
  if (item.text.split(anchor).length !== 2) throw new Error(`${path.basename(file)}锚点不匹配：${marker}`);
  item.text = item.text.replace(anchor, replacement);
}
try {
  const world = path.join(mc, 'world.ts'); const proxy = path.join(mc, 'proxy.ts'); const env = path.join(mc, 'ENV_PROMPT.md');
  edit(world, "from './home.ts'", "import { Vec3 } from 'vec3';", "import { Vec3 } from 'vec3';\nimport { HomeBook, MINECRAFT_HOME_TOOL, type HomeObserver, type Point } from './home.ts';");
  edit(world, '  MINECRAFT_HOME_TOOL,', 'export const MINECRAFT_TOOL_DECLS: ReadonlyArray<Omit<ToolDef, \'handler\'>> = [', 'export const MINECRAFT_TOOL_DECLS: ReadonlyArray<Omit<ToolDef, \'handler\'>> = [\n  MINECRAFT_HOME_TOOL,');
  edit(world, 'private readonly homeBook:', '  private readonly worldFile: string | null;', '  private readonly worldFile: string | null;\n  private readonly homeBook: HomeBook;');
  edit(world, "new HomeBook(ledger('minecraft-home.json'))", "    this.worldFile = ledger('minecraft-world.json');", "    this.worldFile = ledger('minecraft-world.json');\n    this.homeBook = new HomeBook(ledger('minecraft-home.json'));");
  edit(world, 'mc_home: async', "      mc_goal: async (args) => this.toolLog('mc_goal', args, this.setGoal(args)),", "      mc_goal: async (args) => this.toolLog('mc_goal', args, this.setGoal(args)),\n      mc_home: async (args) => this.toolLog('mc_home', args, this.homeTool(args)),");
  const methods = `  private homeObserver(): HomeObserver | null {
    const bot = this.bridge?.connected ? this.bridge.bot : null;
    if (!bot?.entity) return null;
    const at = (v: { x: number; y: number; z: number }): Point => [Math.floor(v.x), Math.floor(v.y), Math.floor(v.z)];
    const player = bot.players['Infinite']?.entity;
    return {
      dimension: normalizeDimension(bot.game.dimension), position: at(bot.entity.position),
      playerPosition: player ? at(player.position) : null,
      read: (p) => { const block = bot.blockAt(new Vec3(...p)); return block ? { name: block.name, properties: block.getProperties() } : null; },
      candidates: (center, radius) => bot.findBlocks({ point: new Vec3(...center), maxDistance: radius, count: 512,
        matching: (block) => block.name.endsWith('_bed') || ['chest', 'trapped_chest', 'barrel', 'crafting_table', 'furnace', 'blast_furnace', 'smoker'].includes(block.name),
      }).map(at),
    };
  }

  private homeTool(raw: unknown): string {
    try {
      const args = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
      const realm = this.realmKey(); const observer = this.homeObserver();
      const action = args.action ?? 'query';
      if (action === 'query') return JSON.stringify(this.homeBook.query(realm, observer));
      if (action === 'remove') {
        this.homeBook.remove(realm, args.confirmation);
        this.emit('minecraft.home', '[Minecraft] 住宅登记已撤销；房子和设施没有被改动。', false, { trigger: 'piggyback' });
        return '住宅登记已撤销；世界方块没有被改动。';
      }
      if (!observer) return '[mc_home] 尚未连接，不能现场调查或登记；query可读历史档案。';
      if (action === 'survey') return JSON.stringify(this.homeBook.survey(observer));
      if (action !== 'save') return '[mc_home] action只支持query/survey/save/remove';
      const home = this.homeBook.save(realm, args, observer);
      this.emit('minecraft.home', '[Minecraft] ' + this.homeBook.summary(realm), false, { trigger: 'piggyback' });
      return '登记已保存；尚未证明已睡着或设好重生点。' + JSON.stringify(home);
    } catch (error) { return '[mc_home 失败] ' + (error instanceof Error ? error.message : String(error)); }
  }

`;
  edit(world, 'private homeObserver()', '  tools(): ToolDef[] {', methods + '  tools(): ToolDef[] {');
  edit(world, "'minecraft.home':", "      'minecraft.world': worldEnvLine(this.worldIdentity()),", "      'minecraft.world': worldEnvLine(this.worldIdentity()),\n      'minecraft.home': this.homeBook.summary(this.realmKey()),");
  edit(world, 'const home = this.homeBook.summary', '    const marks = mapSnapshotLine(this.markTable().list);', '    const marks = mapSnapshotLine(this.markTable().list);\n    const home = this.homeBook.summary(this.realmKey());');
  edit(world, "{ key: 'home' as const", "      { key: 'marks' as const, text: marks, cmp: marks },", "      { key: 'marks' as const, text: marks, cmp: marks },\n      { key: 'home' as const, text: home, cmp: home },");
  edit(world, '|home:${home}', '`|goals:${goals}|marks:${marks}`;', '`|goals:${goals}|marks:${marks}|home:${home}`;');
  edit(proxy, "from './home.ts'", "import { loadPolicy, renderPolicyEnv } from './policy.ts';", "import { loadPolicy, renderPolicyEnv } from './policy.ts';\nimport { HomeBook, homeRealmKey } from './home.ts';");
  edit(proxy, "'minecraft.home':", "      'minecraft.policy': renderPolicyEnv(loadPolicy(this.storageFileOf('minecraft-policy'))),", `      'minecraft.policy': renderPolicyEnv(loadPolicy(this.storageFileOf('minecraft-policy'))),
      'minecraft.home': (() => {
        const world = worldIdentityOf(this.opts.cfg.local.serverDir, this.opts.cfg.host + ':' + this.opts.cfg.port);
        const realm = homeRealmKey(this.opts.cfg.local.serverDir, world.local, world.key, this.opts.cfg.host + ':' + this.opts.cfg.port);
        return new HomeBook(this.opts.dataDir ? join(this.opts.dataDir, 'minecraft-home.json') : null).summary(realm);
      })(),`);
  edit(proxy, "name: 'minecraft.home'", '          vars: [', "          vars: [\n            { name: 'minecraft.home', description: '当前存档的持久住宅登记摘要，存在状态另用mc_home核验。' },");
  edit(env, '{{minecraft.home}}', '{{minecraft.world}}', '{{minecraft.world}}\n{{minecraft.home}}\n住宅认领由用户确认：mc_home survey只列候选，不代表归属；先确认自己的床、用户的床和共享箱子，再保存。已有登记时先查询，不因当前看不到就重新造床或认另一处家。登记设施坐标可交给mc_do use/goto；设施真实状态以现场核验为准。个人约定由你保存到自己的笔记，住宅登记不代写记忆。');
  const from = path.join(root, 'addons/minecraft-home/src/home.ts'); const to = path.join(mc, 'home.ts');
  if (check) {
    if (changes.some((i) => i.text !== i.original) || !fs.existsSync(to) || !fs.readFileSync(from).equals(fs.readFileSync(to))) throw new Error('住宅补丁未安装或自有模块不是最新');
    console.log('住宅补丁锚点及模块均为最新，未写盘');
  } else {
    for (const item of changes) if (item.text !== item.original) {
      const backup = item.file + '.minecraft-home.orig'; if (!fs.existsSync(backup)) fs.copyFileSync(item.file, backup);
      fs.writeFileSync(item.file, item.text, 'utf8');
    }
    fs.copyFileSync(from, to); console.log('住宅补丁已安装；请按正常停机窗口构建并重启，脚本未启动bot');
  }
} catch (error) { console.error(error.message); process.exit(1); }
