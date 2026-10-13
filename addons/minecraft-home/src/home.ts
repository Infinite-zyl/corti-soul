/** Minecraft住宅登记：外部设施事实落盘，现场读数与历史登记分开。 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

export type Point = [number, number, number];
export type HomeRole = 'own-bed' | 'user-bed' | 'shared-storage' | 'workbench' | 'furnace';
export interface HomeBlock { name: string; properties: Record<string, unknown> }
export interface HomeObserver {
  dimension: string;
  position: Point;
  playerPosition: Point | null;
  read(at: Point): HomeBlock | null;
  candidates(center: Point, radius: number): Point[];
}
export interface HomeFacility { at: Point; role: HomeRole; kind: string }
export interface HomeRecord {
  name: string; dimension: string; returnAt: Point; facilities: HomeFacility[];
  confirmation: string; updatedAt: string;
}
interface HomeFile { version: 1; homes: Record<string, HomeRecord> }
/** 主进程只读既有存档标记；不创建身份或修改服务器配置。 */
export function homeRealmKey(serverDir: string, local: boolean, worldKey: string, address: string): string {
  if (local) {
    try {
      const marker = JSON.parse(readFileSync(join(serverDir, worldKey, 'cortico-realm.json'), 'utf8')) as { uuid?: unknown };
      if (typeof marker.uuid === 'string' && marker.uuid.trim()) return `uuid:${marker.uuid}`;
    } catch { /* 无稳定标记时明确使用现有弱身份。 */ }
  }
  return `weak:${address}|${local ? worldKey : ''}`;
}
const ROLES: HomeRole[] = ['own-bed', 'user-bed', 'shared-storage', 'workbench', 'furnace'];
const OFFSETS: Record<string, Point> = { north: [0, 0, -1], south: [0, 0, 1], east: [1, 0, 0], west: [-1, 0, 0] };
const key = (p: Point): string => p.join(',');
const isBed = (name: string): boolean => name.endsWith('_bed');
function point(value: unknown): Point {
  if (!Array.isArray(value) || value.length !== 3 || !value.every((n) => Number.isSafeInteger(n))) {
    throw new Error('坐标必须是三个整数');
  }
  return [...value] as Point;
}
function text(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`${label}不能为空且最多${max}字`);
  return value.trim();
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('登记格式应为对象');
  return value as Record<string, unknown>;
}
function compatible(role: HomeRole, name: string): boolean {
  if (role === 'own-bed' || role === 'user-bed') return isBed(name);
  if (role === 'shared-storage') return ['chest', 'trapped_chest', 'barrel'].includes(name);
  if (role === 'workbench') return name === 'crafting_table';
  return ['furnace', 'blast_furnace', 'smoker'].includes(name);
}
/** 床以头部为登记坐标，合并两半；不从邻近床猜归属。 */
export function canonicalFacility(at: Point, observer: HomeObserver): { at: Point; block: HomeBlock } {
  const block = observer.read(at);
  if (!block) throw new Error(`设施(${key(at)})尚未加载，走近核验后再登记`);
  if (!isBed(block.name)) return { at, block };
  const offset = OFFSETS[String(block.properties.facing)];
  const part = block.properties.part;
  if (!offset || (part !== 'head' && part !== 'foot')) throw new Error('床的朝向或头尾状态无法核验');
  const head = part === 'head' ? at : at.map((n, i) => n + offset[i]!) as Point;
  const foot = head.map((n, i) => n - offset[i]!) as Point;
  const headBlock = observer.read(head);
  const footBlock = observer.read(foot);
  if (!headBlock || !footBlock) throw new Error('床的另一半尚未加载');
  if (headBlock.name !== block.name || footBlock.name !== block.name
    || headBlock.properties.part !== 'head' || footBlock.properties.part !== 'foot'
    || headBlock.properties.facing !== block.properties.facing || footBlock.properties.facing !== block.properties.facing) {
    throw new Error('床头尾不完整或不匹配');
  }
  return { at: head, block: headBlock };
}

function validateHome(value: unknown): HomeRecord {
  const home = object(value);
  const name = text(home.name, '家的名称', 80);
  const dimension = text(home.dimension, '维度', 80);
  const returnAt = point(home.returnAt);
  if (!Array.isArray(home.facilities) || home.facilities.length < 1 || home.facilities.length > 32) throw new Error('设施应为1至32项');
  const used = new Set<string>();
  const facilities = home.facilities.map((raw): HomeFacility => {
    const f = object(raw); const at = point(f.at); const role = f.role as HomeRole;
    if (!ROLES.includes(role)) throw new Error('未知设施用途');
    const kind = text(f.kind, '设施种类', 80);
    if (!compatible(role, kind)) throw new Error('设施用途与种类不匹配');
    if (used.has(key(at))) throw new Error('同一设施不能重复分配');
    used.add(key(at)); return { at, role, kind };
  });
  if (facilities.filter((f) => f.role === 'own-bed').length !== 1) throw new Error('必须明确登记一张自己的床');
  if (facilities.filter((f) => f.role === 'user-bed').length > 1) throw new Error('用户床最多登记一张');
  return { name, dimension, returnAt, facilities,
    confirmation: text(home.confirmation, '用户确认说明', 500), updatedAt: text(home.updatedAt, '更新时间', 80) };
}

export class HomeBook {
  private readonly file: string | null;
  constructor(file: string | null) { this.file = file; }
  private load(): HomeFile {
    if (!this.file || !existsSync(this.file)) return { version: 1, homes: Object.create(null) as Record<string, HomeRecord> };
    try {
      const parsed = object(JSON.parse(readFileSync(this.file, 'utf8')));
      if (parsed.version !== 1) throw new Error('版本不支持');
      const rawHomes = object(parsed.homes);
      const homes = Object.create(null) as Record<string, HomeRecord>;
      for (const [realm, value] of Object.entries(rawHomes)) homes[realm] = validateHome(value);
      return { version: 1, homes };
    } catch (error) { throw new Error(`住宅档案损坏或无法读取，原文件保留：${error instanceof Error ? error.message : String(error)}`); }
  }
  get(realm: string): HomeRecord | null { return this.load().homes[realm] ?? null; }
  private commit(data: HomeFile): void {
    if (!this.file) throw new Error('未配置数据目录，不能持久登记家');
    mkdirSync(dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    try { writeFileSync(temporary, JSON.stringify(data, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' }); renameSync(temporary, this.file); }
    finally { if (existsSync(temporary)) unlinkSync(temporary); }
  }
  summary(realm: string): string {
    try {
      const home = this.get(realm);
      if (!home) return '[家] 尚未登记；现场认家用mc_home，不从重生点猜家或床的归属。';
      const bed = home.facilities.find((f) => f.role === 'own-bed')!;
      return `[家·历史登记] ${home.name}，${home.dimension}，返回(${key(home.returnAt)})；自己的床(${key(bed.at)})，设施${home.facilities.length}项。当前存在/占用情况需mc_home核验；个人约定仍由你写进自己的笔记。`;
    } catch (error) { return `[家] ${error instanceof Error ? error.message : String(error)}`; }
  }
  query(realm: string, observer: HomeObserver | null): object {
    const home = this.get(realm);
    if (!home) return { registered: false, message: '尚未登记家；先survey再向用户确认床和共享设施。' };
    return { registered: true, ...home, facilities: home.facilities.map((f) => {
      if (!observer || observer.dimension !== home.dimension) return { ...f, status: 'unloaded' };
      const block = observer.read(f.at);
      if (!block) return { ...f, status: 'unloaded' };
      if (!compatible(f.role, block.name)) return { ...f, status: 'invalid', actual: block.name };
      try {
        const checked = canonicalFacility(f.at, observer);
        if (key(checked.at) !== key(f.at)) return { ...f, status: 'invalid', actual: '床的头尾位置已改变' };
        const occupied = checked.block.properties.occupied === true || checked.block.properties.occupied === 'true';
        return { ...f, status: isBed(block.name) && occupied ? 'occupied' : 'present', actual: block.name };
      } catch (error) {
        return { ...f, status: String(error).includes('尚未加载') ? 'unloaded' : 'invalid' };
      }
    }) };
  }
  survey(observer: HomeObserver): object {
    const usePlayer = observer.playerPosition !== null
      && Math.hypot(...observer.playerPosition.map((n, i) => n - observer.position[i]!)) <= 32;
    const center = usePlayer ? observer.playerPosition! : observer.position;
    const found = new Map<string, { at: Point; kind: string; occupied?: boolean }>();
    for (const at of observer.candidates(center, 16)) {
      if (Math.hypot(...at.map((n, i) => n - center[i]!)) > 16) continue;
      const block = observer.read(at);
      if (!block || !ROLES.some((role) => compatible(role, block.name))) continue;
      try {
        const item = canonicalFacility(at, observer);
        found.set(key(item.at), { at: item.at, kind: item.block.name,
          ...(isBed(item.block.name) ? { occupied: item.block.properties.occupied === true || item.block.properties.occupied === 'true' } : {}) });
      } catch { /* 不完整或未加载的床不是可登记候选。 */ }
    }
    return { dimension: observer.dimension, center, centerSource: usePlayer ? 'Infinite' : 'corti', radius: 16,
      facilities: [...found.values()].slice(0, 64), omitted: Math.max(0, found.size - 64),
      message: '候选不代表归属；多个床/箱子请向用户确认。只读已加载方块；未列出不代表附近不存在。' };
  }
  save(realm: string, input: unknown, observer: HomeObserver): HomeRecord {
    const args = object(input); const data = this.load(); const old = data.homes[realm];
    if (old && args.replace !== true) throw new Error('当前存档已有家；用户确认更新/搬家后明确传replace:true');
    if (!Array.isArray(args.facilities)) throw new Error('需要确认后的设施列表');
    const facilities = args.facilities.map((raw) => {
      const f = object(raw); const role = f.role as HomeRole;
      if (!ROLES.includes(role)) throw new Error('未知设施用途');
      const at = point(f.at);
      if (Math.hypot(...at.map((n, i) => n - observer.position[i]!)) > 32) throw new Error('登记设施超出现场32格，请走近后核验');
      const actual = canonicalFacility(at, observer);
      if (!compatible(role, actual.block.name)) throw new Error('登记用途与现场方块不匹配');
      return { at: actual.at, kind: actual.block.name, role };
    });
    const returnAt = args.returnAt === undefined ? observer.position : point(args.returnAt);
    if (Math.hypot(...returnAt.map((n, i) => n - observer.position[i]!)) > 32) throw new Error('返回位置超出现场32格');
    const home = validateHome({ name: args.name, dimension: observer.dimension, returnAt, facilities,
      confirmation: args.confirmation, updatedAt: new Date().toISOString() });
    data.homes[realm] = home; this.commit(data); return home;
  }
  remove(realm: string, confirmation: unknown): void {
    text(confirmation, '用户确认说明', 500);
    const data = this.load(); delete data.homes[realm]; this.commit(data);
  }
}

export const MINECRAFT_HOME_TOOL = {
  name: 'mc_home', tags: ['write'] as const,
  description: 'Persistent home and facility records for the current save. With no fields query the registered home and current loaded facility states. action:survey reads loaded blocks within 16 blocks of nearby Infinite (within32), otherwise yourself; candidates do not imply ownership. Ask the user which bed is yours, which bed is theirs and which storage is shared. Only save/update/remove after explicit user confirmation, quote that confirmation. Do not infer home from spawn. Updates require replace:true and a complete facility list. Save records external facts, not personal memory; write personal agreements using your own memory tools. Use exact registered coordinates with existing mc_do use/goto when needed; this tool never moves or sleeps.',
  parameters: { type: 'object', properties: {
    action: { type: 'string', enum: ['query', 'survey', 'save', 'remove'] },
    name: { type: 'string', maxLength: 80 },
    confirmation: { type: 'string', maxLength: 500, description: 'The explicit user confirmation of this registration, update or removal; never invent it.' },
    replace: { type: 'boolean' },
    returnAt: { type: 'array', items: { type: 'integer' }, minItems: 3, maxItems: 3 },
    facilities: { type: 'array', minItems: 1, maxItems: 32, items: { type: 'object', properties: {
      at: { type: 'array', items: { type: 'integer' }, minItems: 3, maxItems: 3 },
      role: { type: 'string', enum: ROLES },
    }, required: ['at', 'role'], additionalProperties: false } },
  }, additionalProperties: false },
};
