import { tuning, type IrritantKind, type Tuning } from '../config/tuning';

export type BlowQuality = 'weak' | 'normal' | 'golden' | 'max_auto';

export interface ReliefMatchState {
  readonly remainingSec: number;
  readonly elapsedSec: number;
  readonly leftAirflowPct: number;
  readonly rightAirflowPct: number;
  readonly score: number;
  readonly clearedCount: number;
  readonly clearComboCount: number;
  readonly reliefModeSec: number;
  readonly reliefCooldownSec: number;
  readonly suffocateTimerSec: number | null;
  readonly wave: number;
  readonly finished: boolean;
  readonly endReason: 'none' | 'time_up' | 'suffocated';
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * 根据单侧鼻腔内堵塞物总面积计算实时通气率（0 ~ 100%）：
 * 堵塞面积越大，通气率单调递减；完全无堵塞时为 100%。
 */
export function computeAirflowPct(blockedArea: number, t: Tuning = tuning): number {
  const ratio = clamp(blockedArea / t.nose.channelMaxBlockedArea, 0, 1);
  return Math.round((1 - ratio) * 100);
}

/**
 * 蓄力猛擤判定曲线：
 * - < 0.2s：轻吹一口（weak）
 * - 0.5s ~ 1.1s：黄金猛喷（golden，可震碎冰块）
 * - >= 1.55s：满条自动触发带轻微头晕提示的普通喷射（max_auto，不再哑火）
 */
export function evaluateBlowStrength(holdSec: number, t: Tuning = tuning): BlowQuality {
  if (holdSec >= t.skills.blowMaxHoldSec) return 'max_auto';
  if (holdSec >= t.skills.blowGoldMinSec && holdSec <= t.skills.blowGoldMaxSec) {
    return 'golden';
  }
  if (holdSec >= t.skills.blowMinChargeSec) return 'normal';
  return 'weak';
}

export function createInitialReliefState(t: Tuning = tuning): ReliefMatchState {
  return {
    remainingSec: t.rules.roundDurationSec,
    elapsedSec: 0,
    leftAirflowPct: 100,
    rightAirflowPct: 100,
    score: 0,
    clearedCount: 0,
    clearComboCount: 0,
    reliefModeSec: 0,
    reliefCooldownSec: 0,
    suffocateTimerSec: null,
    wave: 1,
    finished: false,
    endReason: 'none',
  };
}

export interface ReliefStepInput {
  readonly dtSec: number;
  readonly leftAirflowPct: number;
  readonly rightAirflowPct: number;
}

export interface ReliefStepResult {
  readonly state: ReliefMatchState;
  readonly triggeredClearBurst: boolean;
  readonly exitedReliefMode: boolean;
  readonly enteredSuffocate: boolean;
}

export function stepReliefMatch(
  prev: ReliefMatchState,
  input: ReliefStepInput,
  t: Tuning = tuning,
): ReliefStepResult {
  if (prev.finished) {
    return {
      state: prev,
      triggeredClearBurst: false,
      exitedReliefMode: false,
      enteredSuffocate: false,
    };
  }

  const dtSec = Math.max(0, input.dtSec);
  const remainingSec = Math.max(0, prev.remainingSec - dtSec);
  const elapsedSec = prev.elapsedSec + dtSec;
  const leftAirflowPct = clamp(input.leftAirflowPct, 0, 100);
  const rightAirflowPct = clamp(input.rightAirflowPct, 0, 100);

  let score = prev.score;
  let clearComboCount = prev.clearComboCount;
  let reliefModeSec = Math.max(0, prev.reliefModeSec - dtSec);
  let reliefCooldownSec = Math.max(0, prev.reliefCooldownSec - dtSec);
  let wave = prev.wave;
  let triggeredClearBurst = false;
  const exitedReliefMode = prev.reliefModeSec > 0 && reliefModeSec === 0;

  if (exitedReliefMode) {
    wave += 1;
  }

  // Check "双孔贯通！神清气爽！"
  if (
    prev.reliefModeSec <= 0 &&
    reliefCooldownSec <= 0 &&
    elapsedSec >= 1.2 &&
    leftAirflowPct >= t.rules.clearAirflowThresholdPct &&
    rightAirflowPct >= t.rules.clearAirflowThresholdPct
  ) {
    triggeredClearBurst = true;
    clearComboCount += 1;
    reliefModeSec = t.rules.clearBonusDurationSec;
    reliefCooldownSec = t.rules.clearBonusDurationSec + 1.8;
  }

  if (prev.reliefModeSec > 0 || triggeredClearBurst) {
    const activeSec = triggeredClearBurst ? dtSec : Math.min(dtSec, prev.reliefModeSec);
    score += t.rules.clearPointsPerSec * t.rules.clearMultiplier * activeSec;
  }

  // Check Suffocation crisis: both sides < 18%
  let suffocateTimerSec = prev.suffocateTimerSec;
  let enteredSuffocate = false;
  if (reliefModeSec > 0) {
    suffocateTimerSec = null;
  } else if (
    leftAirflowPct < t.rules.suffocateThresholdPct &&
    rightAirflowPct < t.rules.suffocateThresholdPct
  ) {
    if (suffocateTimerSec === null) {
      suffocateTimerSec = t.rules.suffocateLimitSec;
      enteredSuffocate = true;
    } else {
      suffocateTimerSec = Math.max(0, suffocateTimerSec - dtSec);
    }
  } else if (
    leftAirflowPct >= t.rules.suffocateRecoverPct ||
    rightAirflowPct >= t.rules.suffocateRecoverPct
  ) {
    suffocateTimerSec = null;
  }

  let finished = false;
  let endReason: ReliefMatchState['endReason'] = 'none';
  if (suffocateTimerSec !== null && suffocateTimerSec <= 0) {
    finished = true;
    endReason = 'suffocated';
  } else if (remainingSec <= 0) {
    finished = true;
    endReason = 'time_up';
  }

  return {
    state: {
      remainingSec,
      elapsedSec,
      leftAirflowPct,
      rightAirflowPct,
      score,
      clearedCount: prev.clearedCount,
      clearComboCount,
      reliefModeSec,
      reliefCooldownSec,
      suffocateTimerSec,
      wave,
      finished,
      endReason,
    },
    triggeredClearBurst,
    exitedReliefMode,
    enteredSuffocate,
  };
}

export function recordIrritantCleared(
  prev: ReliefMatchState,
  kind: IrritantKind,
  t: Tuning = tuning,
): { readonly state: ReliefMatchState; readonly points: number } {
  const base = t.irritants[kind].score;
  const mult = prev.reliefModeSec > 0 ? t.rules.clearMultiplier : 1;
  const points = base * mult;
  return {
    state: {
      ...prev,
      score: prev.score + points,
      clearedCount: prev.clearedCount + 1,
    },
    points,
  };
}

export function pickIrritantKindForWave(wave: number, rng: () => number = Math.random): IrritantKind {
  const r = clamp(rng(), 0, 0.9999);
  if (wave <= 1) {
    if (r < 0.55) return 'mucus';
    if (r < 0.8) return 'pollen';
    if (r < 0.94) return 'hairball';
    return 'ice';
  }
  // Later waves have more hairballs, pollen, and ice blocks!
  if (r < 0.34) return 'mucus';
  if (r < 0.62) return 'hairball';
  if (r < 0.84) return 'pollen';
  return 'ice';
}

export function buildDiagnosisSummary(state: ReliefMatchState): {
  readonly headline: string;
  readonly comment: string;
} {
  if (state.endReason === 'suffocated') {
    return {
      headline: '双孔彻底焊死！憋晕过去',
      comment: '鼻腔已成毛线与花粉仓库，建议随身携带洗鼻水枪！',
    };
  }
  if (state.clearComboCount >= 3) {
    return {
      headline: `成功贯通 ${state.clearComboCount} 次！今日神清气爽`,
      comment: '通气大师亲自坐镇，暂时允许继续快乐撸猫！',
    };
  }
  if (state.clearComboCount >= 1) {
    return {
      headline: `顺利贯通 ${state.clearComboCount} 次！呼吸重新上线`,
      comment: '黄金猛擤节奏不错，下次争取多炸碎几块冷空气冰！',
    };
  }
  return {
    headline: '勉强撑完 60 秒的半通气选手',
    comment: '猫毛和鼻涕还在拐角抱团，记得多搓一搓再猛擤！',
  };
}
