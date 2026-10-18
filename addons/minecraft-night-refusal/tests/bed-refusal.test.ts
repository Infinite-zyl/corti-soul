/**
 * 床被拒时回执要带上服务端给的原因。
 * 原版把「为什么不行」只写在动作栏:回执只说「没躺下」的话,她读不出该去清怪还是换床,
 * 只能反复点床。2026-10-18 夜间 62 次 mc_do 全被拒就是这么来的。
 */
import { describe, expect, it } from 'vitest';
import { useProbeAt } from '../../../src/worlds/minecraft/skills-interact.ts';
import type { SkillContext } from '../../../src/worlds/minecraft/skill-context.ts';

const cell = { x: 10, y: 64, z: 10 } as never;

function probe(ctx: Partial<SkillContext>) {
  const bot = { isSleeping: false, time: { timeOfDay: 13000 } };
  return useProbeAt(bot as never, null, cell, 'yellow_bed', ctx as SkillContext);
}

describe('床被拒的回执', () => {
  it('带上服务端原文,她才知道是怪的问题', () => {
    const p = probe({ serverRefusal: () => 'You may not rest now; there are monsters nearby' });
    expect(p?.read()).toEqual({
      met: false,
      actual: '没躺下(现在 dayTime 13000),服务端说「You may not rest now; there are monsters nearby」',
    });
  });

  it('没有拒绝原因时不多说一句', () => {
    const p = probe({ serverRefusal: () => null });
    expect(p?.read()).toEqual({ met: false, actual: '没躺下(现在 dayTime 13000)' });
  });

  it('没接这个钩子的部署行为不变', () => {
    const p = probe({});
    expect(p?.read()).toEqual({ met: false, actual: '没躺下(现在 dayTime 13000)' });
  });

  it('原因与重生点同时存在时两句都在', () => {
    const p = probe({
      serverRefusal: () => 'You may not rest now; there are monsters nearby',
      spawnNote: () => '但重生点已经记下了',
    });
    const out = p?.read();
    expect(out).toMatchObject({ met: false });
    expect((out as { actual: string }).actual).toContain('monsters nearby');
    expect((out as { actual: string }).actual).toContain('重生点已经记下了');
  });

  it('躺下成功时不提拒绝原因', () => {
    const bot = { isSleeping: true, time: { timeOfDay: 13000 } };
    const p = useProbeAt(bot as never, null, cell, 'yellow_bed', {
      serverRefusal: () => 'stale',
    } as SkillContext);
    expect(p?.read()).toEqual({ met: true, actual: '躺下了' });
  });
});
