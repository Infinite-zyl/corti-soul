/**
 * 夜间死锁修复:床被拒的回执带上服务端原因,夜间放行自保动作。
 *
 * 两处都只改判据与措辞,不新增配置、不改数据结构:
 *   1. 回执:World 记下最近一条"拒绝"性质的服务器原文,床被拒时一并回念。
 *   2. 闸门:夜间优先只挡普通工作,flee/attack/surface/eat 这类自保动作照收;
 *      受理与 pump 两处判据必须一致,否则放行的单会静默卡在队列里。
 *
 * 默认只预检,--apply 才写盘并留 .night-refusal.orig;--revert 反向还原。
 *
 * 锚点一律写成"行数组用 \n 连接",不用模板字符串:这些片段本身含反引号与 ${},
 * 在模板里会被插值,写出来的字面量与文件对不上。
 */
import fs from 'node:fs';
import path from 'node:path';

const repo = path.resolve(import.meta.dirname, '..');
const root = path.resolve(
  process.env.CORTICO_ROOT ??
    JSON.parse(fs.readFileSync(path.join(repo, 'runtime-selection.json'), 'utf8')).corticoRoot,
);
const mc = path.join(root, 'src/worlds/minecraft');
const apply = process.argv.includes('--apply');
const revert = process.argv.includes('--revert');

const lines = (...rows) => rows.join('\n');

const edits = [
  {
    file: 'skill-context.ts',
    marker: 'serverRefusal?: () => string | null;',
    from: lines('  spawnNote?: () => string | null;'),
    to: lines(
      '  spawnNote?: () => string | null;',
      '  /**',
      '   * 刚刚服务端用动作栏/系统消息拒绝过这一次动作时,那句原文(World 听 message)。',
      '   * 原版把「为什么不行」只写在动作栏里:床被拒是 "You may not rest now; there are',
      '   * monsters nearby",回执只说「没躺下」的话,她读不出该去清怪还是换床。',
      '   */',
      '  serverRefusal?: () => string | null;',
    ),
  },
  {
    file: 'executor.ts',
    marker: "serverRefusal?: SkillContext['serverRefusal'];",
    from: lines(
      '  /** 白天点床时重生点已经悄悄搬走了没有(World 持有 set_spawn 的时刻) */',
      "  spawnNote?: SkillContext['spawnNote'];",
    ),
    to: lines(
      '  /** 白天点床时重生点已经悄悄搬走了没有(World 持有 set_spawn 的时刻) */',
      "  spawnNote?: SkillContext['spawnNote'];",
      '  /** 服务端刚刚拒绝这一动作时说的那句原文(World 听动作栏/系统消息) */',
      "  serverRefusal?: SkillContext['serverRefusal'];",
    ),
  },
  {
    file: 'executor.ts',
    marker: 'serverRefusal: this.opts.serverRefusal,',
    from: lines(
      '      spawnNote: this.opts.spawnNote,',
      '      spawnAnchor: this.opts.spawnAnchor,',
    ),
    to: lines(
      '      spawnNote: this.opts.spawnNote,',
      '      serverRefusal: this.opts.serverRefusal,',
      '      spawnAnchor: this.opts.spawnAnchor,',
    ),
  },
  {
    file: 'executor.ts',
    marker: 'SELF_PRESERVATION_SKILLS',
    from: lines(' * 队列按提交顺序执行，步骤依赖规则见 StepBounds。'),
    to: lines(
      ' * 夜间优先只挡普通工作;这几条是"先把威胁处理掉才能睡"的自保动作。',
      ' * 只认确切的技能名,不按关键词猜:放过一个普通采集单会打乱夜间规则。',
      ' */',
      'const SELF_PRESERVATION_SKILLS: ReadonlySet<string> = new Set([',
      "  'flee', 'attack', 'surface', 'eat',",
      ']);',
      '',
      'function isSelfPreservation(step: SkillCall): boolean {',
      "  return SELF_PRESERVATION_SKILLS.has((step as { skill?: string }).skill ?? '');",
      '}',
      '',
      '/**',
      ' * 队列按提交顺序执行，步骤依赖规则见 StepBounds。',
    ),
  },
  {
    file: 'executor.ts',
    marker: '!steps.every(isSelfPreservation)',
    from: lines(
      "    if(this.restOnly && !nightRest)return '夜间回家睡觉优先：这件普通工作没有接单，白天再安排；不能用now抢占。';",
    ),
    to: lines(
      '    // 夜间只收"回家睡觉"这一类单,但自保动作必须放行:床被怪围着睡不下时,',
      '    // 她需要能先打掉/跑开再睡;全拒会把"打掉门口的怪"这条路也堵死。',
      "    if(this.restOnly && !nightRest && !steps.every(isSelfPreservation))return '夜间回家睡觉优先：这件普通工作没有接单，白天再安排；不能用now抢占。';",
    ),
  },
  {
    file: 'executor.ts',
    marker: 't.steps.every(isSelfPreservation)',
    from: lines(
      '    const nextIndex = this.restOnly ? this.queue.findIndex(t=>t.nightRest) : 0;',
    ),
    to: lines(
      '    // 夜间只开夜间专用单,以及被受理闸放行的自保单:受理放行而这里不挑,那一单就永远排在队里。',
      '    const nextIndex = this.restOnly',
      '      ? this.queue.findIndex(t=>t.nightRest || t.steps.every(isSelfPreservation))',
      '      : 0;',
    ),
  },
  {
    file: 'skills-interact.ts',
    marker: 'const whyText',
    from: lines(
      '        const spawn = ctx?.spawnNote?.() ?? null;',
      '        return {',
      '          met: false,',
      '          actual: `没躺下(现在 dayTime ${Math.round(bot.time?.timeOfDay ?? 0)})${spawn ? `,${spawn}` : \'\'}`,',
      '        };',
    ),
    to: lines(
      '        const spawn = ctx?.spawnNote?.() ?? null;',
      '        // 原版把拒绝原因只写在动作栏(怪物在附近/床被占/太远);不带上她就只能反复点床。',
      '        const why = ctx?.serverRefusal?.() ?? null;',
      "        const whyText = why ? `,服务端说「${why}」` : '';",
      '        return {',
      '          met: false,',
      '          actual: `没躺下(现在 dayTime ${Math.round(bot.time?.timeOfDay ?? 0)})${whyText}${spawn ? `,${spawn}` : \'\'}`,',
      '        };',
    ),
  },
  {
    file: 'world.ts',
    marker: 'REFUSAL_PATTERN',
    from: lines(
      '/** 原版客户端动作栏一条文字显示 60 tick(Gui.setOverlayMessage),期间收到同一文字只重置计时。 */',
      'export const ACTION_BAR_SHOW_MS = 60 * 50;',
    ),
    to: lines(
      '/** 原版客户端动作栏一条文字显示 60 tick(Gui.setOverlayMessage),期间收到同一文字只重置计时。 */',
      'export const ACTION_BAR_SHOW_MS = 60 * 50;',
      '',
      '/**',
      ' * 服务端拒绝动作时的原文特征。原版把原因只写在动作栏或系统消息里,',
      ' * 回执只说「没躺下」的话,她读不出该去清怪、换床还是等天亮。',
      ' */',
      'const REFUSAL_PATTERN =',
      "  /may not rest|monsters nearby|you can only sleep at night|too far away|not valid|no bed|obstructed|already (?:sleeping|occupied)|cannot|could not|couldn't|unable to|not allowed|failed|拒绝|无法|不能/i;",
      '',
      '/** 一条拒绝原文只在这么久的窗口内算"这一步的原因",再久就与本次动作无关。 */',
      'const REFUSAL_NOTE_MS = 5_000;',
    ),
  },
  {
    file: 'world.ts',
    marker: 'private lastRefusal',
    from: lines(
      '  /** 最近一条动作栏文字及收到时刻 */',
      '  private lastActionBar: { text: string; at: number } | null = null;',
    ),
    to: lines(
      '  /** 最近一条动作栏文字及收到时刻 */',
      '  private lastActionBar: { text: string; at: number } | null = null;',
      '  /**',
      '   * 最近一条"拒绝"性质的服务器原文(动作栏或系统消息)及收到时刻。',
      '   * 只在回执侧读一次,不改变执行:原版把「为什么不行」只写在这里。',
      '   */',
      '  private lastRefusal: { text: string; at: number } | null = null;',
    ),
  },
  {
    file: 'world.ts',
    marker: 'this.noteRefusal(text);',
    from: lines(
      '      const text = jsonMsg.toString().trim();',
      '      if (!text) return;',
      "      if (slot === 'system') {",
    ),
    to: lines(
      '      const text = jsonMsg.toString().trim();',
      '      if (!text) return;',
      '      this.noteRefusal(text);',
      "      if (slot === 'system') {",
    ),
  },
  {
    file: 'world.ts',
    marker: 'private noteRefusal',
    from: lines('   * 实体接近报告:16 格进、24 格出的滞回状态机,1s 采样。'),
    to: lines(
      '   * 记下"拒绝"性质的服务器原文,供失败回执引用。只认否定措辞,',
      '   * 避免把「游戏已保存」这类播报也当成拒绝原因带进回执。',
      '   */',
      '  private noteRefusal(text: string): void {',
      '    if (!REFUSAL_PATTERN.test(text)) return;',
      '    this.lastRefusal = { text, at: Date.now() };',
      '  }',
      '',
      '  /**',
      '   * 这一步刚被服务端拒绝过就返回那句原文;超过 REFUSAL_NOTE_MS 视为与本次无关。',
      '   * 与 spawnNote 同一定位:只给回执补事实,不改变任何执行判据。',
      '   */',
      '  private recentRefusal(): string | null {',
      '    const hit = this.lastRefusal;',
      '    if (!hit || Date.now() - hit.at > REFUSAL_NOTE_MS) return null;',
      '    return hit.text;',
      '  }',
      '',
      '  /**',
      '   * 实体接近报告:16 格进、24 格出的滞回状态机,1s 采样。',
    ),
  },
  {
    file: 'world.ts',
    marker: 'serverRefusal: () => this.recentRefusal()',
    from: lines('      spawnNote: () => this.freshSpawnNote(),'),
    to: lines(
      '      spawnNote: () => this.freshSpawnNote(),',
      '      serverRefusal: () => this.recentRefusal(),',
    ),
  },
];

const read = (name) => fs.readFileSync(name, 'utf8').replaceAll('\r\n', '\n');

if (revert) {
  // 每次从磁盘重读:同一文件有多处改动,用加载时的快照会把前一处还原覆盖掉。
  let restored = 0;
  for (const edit of [...edits].reverse()) {
    const name = path.join(mc, edit.file);
    const now = read(name);
    if (!now.includes(edit.marker)) continue;
    if (!now.includes(edit.to)) throw Error(`反向锚点不匹配 ${edit.file}:${edit.marker}`);
    fs.writeFileSync(name, now.replace(edit.to, edit.from));
    restored++;
  }
  console.log(`已还原 ${restored} 处。`);
  process.exit(0);
}

const pending = [];
for (const edit of edits) {
  const name = path.join(mc, edit.file);
  const text = read(name);
  if (!text.includes(edit.marker)) pending.push({ edit, name, text });
}
console.log(`夜间死锁修复:${edits.length - pending.length} 处已改,${pending.length} 处待改。`);
for (const { edit } of pending) console.log(`  待改 ${edit.file} (${edit.marker})`);

if (!pending.length) {
  console.log('已经全部到位,无需改动。');
  process.exit(0);
}
if (!apply) {
  console.log('\n预检通过;加 --apply 才写盘(会先留 <文件>.night-refusal.orig)。');
  process.exit(0);
}

// 先校验所有锚点都能唯一匹配,再动手,避免写一半。
for (const { edit, name } of pending) {
  const text = read(name);
  if (text.split(edit.from).length !== 2) throw Error(`锚点不唯一或不存在 ${edit.file}:${edit.marker}`);
}
for (const { edit, name, text } of pending) {
  const orig = `${name}.night-refusal.orig`;
  if (!fs.existsSync(orig)) fs.writeFileSync(orig, text);
  const now = read(name);
  if (!now.includes(edit.from)) throw Error(`写入前锚点已变 ${edit.file}:${edit.marker}`);
  fs.writeFileSync(name, now.replace(edit.from, edit.to));
}
console.log(`\n已写入 ${pending.length} 处。重启 bot 后生效。`);
console.log('回滚:node patches/patch-minecraft-night-refusal.mjs --revert');
