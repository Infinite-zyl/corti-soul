/**
 * 夜间优先只挡普通工作;自保动作必须放行,否则床被怪围着时她连"先清怪再睡"都做不到。
 * 2026-10-18 实测:夜间 62 次 mc_do 全被拒,占掉 33% 的输入 token。
 */
import { describe, expect, it } from 'vitest';
import { makeExecutor } from './executor-harness.ts';

const goto = { skill: 'goto', at: [10, 64, 10] } as const;

describe('夜间优先的受理闸', () => {
  it('普通工作被拒,回执说明白天再安排', () => {
    const { exec } = makeExecutor();
    exec.setNightPriority(true);
    const receipt = exec.submit([goto] as never);
    expect(receipt).toContain('这件普通工作没有接单');
    expect(receipt).toContain('白天再安排');
  });

  it('自保动作放行,不再被夜间闸门拒收', () => {
    const { exec } = makeExecutor();
    exec.setNightPriority(true);
    const steps = [
      { skill: 'flee', distance: 8 },
      { skill: 'attack', target: 'zombie' },
      { skill: 'surface' },
      { skill: 'eat', item: 'bread' },
    ];
    for (const step of steps) {
      expect(exec.submit([step] as never)).not.toContain('没有接单');
    }
  });

  it('普通工作夹着自保动作时整单仍被拒:放行要整单都是自保', () => {
    const { exec } = makeExecutor();
    exec.setNightPriority(true);
    const receipt = exec.submit([{ skill: 'flee', distance: 8 }, goto] as never);
    expect(receipt).toContain('没有接单');
  });

  it('白天不受这道闸影响', () => {
    const { exec } = makeExecutor();
    expect(exec.submit([goto] as never)).not.toContain('没有接单');
  });

  it('天亮后普通工作恢复受理', () => {
    const { exec } = makeExecutor();
    exec.setNightPriority(true);
    expect(exec.submit([goto] as never)).toContain('没有接单');
    exec.setNightPriority(false);
    expect(exec.submit([goto] as never)).not.toContain('没有接单');
  });
});

describe('夜间自保单真的会被执行', () => {
  it('受理闸放行后,pump 也要挑中它,否则永远排在队里', async () => {
    // 只受理不挑中的话,自保单会静默卡在队列里 —— 受理与执行两处判据必须一致。
    const { exec, reports } = makeExecutor();
    exec.setNightPriority(true);
    exec.submit([{ skill: 'surface' }] as never);
    await new Promise((r) => setTimeout(r, 50));
    expect(reports.length).toBeGreaterThan(0);
  });
});
