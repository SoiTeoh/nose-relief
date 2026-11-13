import { describe, expect, it } from 'vitest';
import { tuning } from '../src/config/tuning';
import {
  buildDiagnosisSummary,
  computeAirflowPct,
  createInitialReliefState,
  evaluateBlowStrength,
  pickIrritantKindForWave,
  recordIrritantCleared,
  stepReliefMatch,
} from '../src/game/rules';

describe('computeAirflowPct', () => {
  it('returns 100% when passage is empty and 0% at max blockage', () => {
    expect(computeAirflowPct(0, tuning)).toBe(100);
    expect(computeAirflowPct(tuning.nose.channelMaxBlockedArea, tuning)).toBe(0);
    expect(computeAirflowPct(tuning.nose.channelMaxBlockedArea * 2, tuning)).toBe(0);
  });

  it('decreases monotonically as blockedArea increases', () => {
    const a = computeAirflowPct(500, tuning);
    const b = computeAirflowPct(1800, tuning);
    const c = computeAirflowPct(3200, tuning);
    expect(a).toBeGreaterThan(b);
    expect(b).toBeGreaterThan(c);
  });

  it('clamps negative blockedArea safely to 100%', () => {
    expect(computeAirflowPct(-200, tuning)).toBe(100);
  });
});

describe('evaluateBlowStrength', () => {
  it('classifies weak, normal, golden, and max_auto charge durations accurately', () => {
    expect(evaluateBlowStrength(0.1, tuning)).toBe('weak');
    expect(evaluateBlowStrength(0.35, tuning)).toBe('normal');
    expect(evaluateBlowStrength(0.75, tuning)).toBe('golden');
    expect(evaluateBlowStrength(1.25, tuning)).toBe('normal');
    expect(evaluateBlowStrength(1.6, tuning)).toBe('max_auto');
  });

  it('handles exact threshold boundaries (0.2s, 0.5s, 1.1s, 1.55s)', () => {
    expect(evaluateBlowStrength(tuning.skills.blowMinChargeSec, tuning)).toBe('normal');
    expect(evaluateBlowStrength(tuning.skills.blowGoldMinSec, tuning)).toBe('golden');
    expect(evaluateBlowStrength(tuning.skills.blowGoldMaxSec, tuning)).toBe('golden');
    expect(evaluateBlowStrength(tuning.skills.blowMaxHoldSec, tuning)).toBe('max_auto');
  });
});

describe('stepReliefMatch', () => {
  it('triggers 双孔贯通 (3.5s ×3 relief mode) when both sides reach >= 85%', () => {
    const s = { ...createInitialReliefState(tuning), elapsedSec: 2.0 };
    const res = stepReliefMatch(
      s,
      { dtSec: 0.1, leftAirflowPct: 90, rightAirflowPct: 86 },
      tuning,
    );
    expect(res.triggeredClearBurst).toBe(true);
    expect(res.state.clearComboCount).toBe(1);
    expect(res.state.reliefModeSec).toBeCloseTo(tuning.rules.clearBonusDurationSec, 4);
  });

  it('awards ×3 fresh-air points during relief mode and advances wave when it ends', () => {
    const inRelief = {
      ...createInitialReliefState(tuning),
      elapsedSec: 5.0,
      reliefModeSec: 0.1,
      wave: 1,
    };
    const res = stepReliefMatch(
      inRelief,
      { dtSec: 0.15, leftAirflowPct: 95, rightAirflowPct: 95 },
      tuning,
    );
    expect(res.exitedReliefMode).toBe(true);
    expect(res.state.wave).toBe(2);
    expect(res.state.score).toBeCloseTo(
      tuning.rules.clearPointsPerSec * tuning.rules.clearMultiplier * 0.1,
      3,
    );
  });

  it('does not trigger relief mode if only one nostril is >= 85%', () => {
    const s = { ...createInitialReliefState(tuning), elapsedSec: 3.0 };
    const res = stepReliefMatch(
      s,
      { dtSec: 0.1, leftAirflowPct: 95, rightAirflowPct: 60 },
      tuning,
    );
    expect(res.triggeredClearBurst).toBe(false);
    expect(res.state.reliefModeSec).toBe(0);
  });

  it('prevents immediate re-trigger of relief mode while reliefCooldownSec > 0', () => {
    const s = {
      ...createInitialReliefState(tuning),
      elapsedSec: 10.0,
      reliefCooldownSec: 1.2,
    };
    const res = stepReliefMatch(
      s,
      { dtSec: 0.1, leftAirflowPct: 95, rightAirflowPct: 95 },
      tuning,
    );
    expect(res.triggeredClearBurst).toBe(false);
    expect(res.state.reliefModeSec).toBe(0);
  });

  it('keeps suffocation timer active in hysteresis band (18%..21%) until recovering >= 22%', () => {
    const s = {
      ...createInitialReliefState(tuning),
      elapsedSec: 6.0,
      suffocateTimerSec: 2.5,
    };
    const res = stepReliefMatch(
      s,
      { dtSec: 0.1, leftAirflowPct: 20, rightAirflowPct: 19 },
      tuning,
    );
    expect(res.state.suffocateTimerSec).toBe(2.5);
  });

  it('starts 4.5s suffocation countdown when both sides drop below 18%', () => {
    const s = { ...createInitialReliefState(tuning), elapsedSec: 5.0 };
    const res = stepReliefMatch(
      s,
      { dtSec: 0.1, leftAirflowPct: 12, rightAirflowPct: 15 },
      tuning,
    );
    expect(res.enteredSuffocate).toBe(true);
    expect(res.state.suffocateTimerSec).toBeCloseTo(tuning.rules.suffocateLimitSec, 4);
  });

  it('cancels suffocation alarm once either side recovers to >= 22%', () => {
    const s = {
      ...createInitialReliefState(tuning),
      elapsedSec: 6.0,
      suffocateTimerSec: 2.5,
    };
    const res = stepReliefMatch(
      s,
      { dtSec: 0.1, leftAirflowPct: 24, rightAirflowPct: 10 },
      tuning,
    );
    expect(res.state.suffocateTimerSec).toBeNull();
    expect(res.state.finished).toBe(false);
  });

  it('ends match with endReason suffocated when countdown reaches 0', () => {
    const s = {
      ...createInitialReliefState(tuning),
      elapsedSec: 10.0,
      suffocateTimerSec: 0.05,
    };
    const res = stepReliefMatch(
      s,
      { dtSec: 0.1, leftAirflowPct: 8, rightAirflowPct: 10 },
      tuning,
    );
    expect(res.state.finished).toBe(true);
    expect(res.state.endReason).toBe('suffocated');
  });

  it('ends match with endReason time_up at 60s and freezes afterward', () => {
    const s = { ...createInitialReliefState(tuning), remainingSec: 0.05 };
    const ended = stepReliefMatch(
      s,
      { dtSec: 0.1, leftAirflowPct: 60, rightAirflowPct: 60 },
      tuning,
    );
    expect(ended.state.finished).toBe(true);
    expect(ended.state.endReason).toBe('time_up');
    expect(ended.state.remainingSec).toBe(0);

    const after = stepReliefMatch(
      ended.state,
      { dtSec: 1.0, leftAirflowPct: 95, rightAirflowPct: 95 },
      tuning,
    );
    expect(after.state).toEqual(ended.state);
  });
});

describe('Scoring, Waves & Diagnosis', () => {
  it('awards base score normally and ×3 score during reliefModeSec > 0', () => {
    const normal = recordIrritantCleared(createInitialReliefState(tuning), 'hairball', tuning);
    expect(normal.points).toBe(tuning.irritants.hairball.score);
    expect(normal.state.clearedCount).toBe(1);

    const boosted = recordIrritantCleared(
      { ...createInitialReliefState(tuning), reliefModeSec: 2.0 },
      'ice',
      tuning,
    );
    expect(boosted.points).toBe(tuning.irritants.ice.score * tuning.rules.clearMultiplier);
  });

  it('records mucus and pollen clear points accurately', () => {
    const s0 = createInitialReliefState(tuning);
    const m = recordIrritantCleared(s0, 'mucus', tuning);
    const p = recordIrritantCleared(m.state, 'pollen', tuning);
    expect(m.points).toBe(tuning.irritants.mucus.score);
    expect(p.points).toBe(tuning.irritants.pollen.score);
    expect(p.state.clearedCount).toBe(2);
  });

  it('picks all 4 irritant kinds across rng ranges and increases hairball/ice share in later waves', () => {
    expect(pickIrritantKindForWave(1, () => 0.1)).toBe('mucus');
    expect(pickIrritantKindForWave(1, () => 0.6)).toBe('pollen');
    expect(pickIrritantKindForWave(1, () => 0.85)).toBe('hairball');
    expect(pickIrritantKindForWave(1, () => 0.98)).toBe('ice');

    expect(pickIrritantKindForWave(2, () => 0.5)).toBe('hairball');
    expect(pickIrritantKindForWave(2, () => 0.9)).toBe('ice');
  });

  it('generates distinct humorous diagnosis messages for suffocated, high-clear, and low-clear runs', () => {
    const suff = buildDiagnosisSummary({
      ...createInitialReliefState(tuning),
      finished: true,
      endReason: 'suffocated',
    });
    expect(suff.headline).toContain('憋晕');

    const master = buildDiagnosisSummary({
      ...createInitialReliefState(tuning),
      finished: true,
      endReason: 'time_up',
      clearComboCount: 3,
    });
    expect(master.headline).toContain('3 次');

    const partial = buildDiagnosisSummary({
      ...createInitialReliefState(tuning),
      finished: true,
      endReason: 'time_up',
      clearComboCount: 0,
    });
    expect(partial.headline).toContain('半通气');
  });
});
