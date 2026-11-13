import Matter from 'matter-js';
import { tuning, type IrritantKind, type Tuning } from '../config/tuning';
import {
  clamp,
  computeAirflowPct,
  createInitialReliefState,
  evaluateBlowStrength,
  pickIrritantKindForWave,
  recordIrritantCleared,
  stepReliefMatch,
  type BlowQuality,
  type ReliefMatchState,
} from './rules';

export interface IrritantEntity {
  readonly id: number;
  readonly kind: IrritantKind;
  readonly radius: number;
  readonly body: Matter.Body;
  pollenTimerSec: number;
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  color: string;
  life: number;
  maxLife: number;
}

export interface FloatingText {
  x: number;
  y: number;
  text: string;
  color: string;
  scale: number;
  life: number;
  maxLife: number;
}

export interface WorldStepEvents {
  readonly clearedCountThisStep: number;
  readonly triggeredClearBurst: boolean;
  readonly enteredSuffocate: boolean;
  readonly autoBlowTriggered: boolean;
}

export class NoseReliefWorld {
  readonly t: Tuning;
  readonly engine: Matter.Engine;
  readonly wallBodies: Matter.Body[] = [];
  match: ReliefMatchState;
  irritants: IrritantEntity[] = [];
  particles: Particle[] = [];
  floats: FloatingText[] = [];

  sprayCooldownSec = 0;
  sprayActiveSec = 0;
  spraySide: 'left' | 'right' = 'left';

  mintCooldownSec = 0;
  mintCalmSec = 0;

  blowHolding = false;
  blowHoldSec = 0;
  lastActiveSide: 'left' | 'right' = 'left';

  shakeMag = 0;
  dizzySec = 0;
  noseBlush = 0;

  private nextId = 1;
  private spawnTimerSec = 0.5;

  constructor(t: Tuning = tuning) {
    this.t = t;
    this.engine = Matter.Engine.create({
      enableSleeping: false,
      gravity: { x: 0, y: 0.2 },
    });
    this.match = createInitialReliefState(t);

    this.buildNasalWalls();
    this.seedInitialBlockage();
  }

  private buildNasalWalls(): void {
    const { septumX, septumHalfW, topY, nostrilExitY, leftOuterX, rightOuterX } = this.t.nose;
    const opts: Matter.IChamferableBodyDefinition = {
      isStatic: true,
      friction: 0.65,
      frictionStatic: 0.9,
      restitution: 0.18,
    };

    const walls: Matter.Body[] = [
      // Left outer wall + mid-lower turbinate curve + narrowed nostril bottleneck
      Matter.Bodies.rectangle(leftOuterX - 12, 290, 24, 340, opts),
      Matter.Bodies.circle(leftOuterX - 4, 342, 34, opts),
      Matter.Bodies.circle(septumX - septumHalfW + 10, 390, 24, opts),
      Matter.Bodies.rectangle(leftOuterX + 16, 462, 34, 54, { ...opts, angle: -0.34 }),
      Matter.Bodies.rectangle(septumX - septumHalfW - 10, 466, 26, 42, { ...opts, angle: 0.25 }),
      // Right outer wall + mid-lower turbinate curve + narrowed nostril bottleneck
      Matter.Bodies.rectangle(rightOuterX + 12, 290, 24, 340, opts),
      Matter.Bodies.circle(rightOuterX + 4, 342, 34, opts),
      Matter.Bodies.circle(septumX + septumHalfW - 10, 390, 24, opts),
      Matter.Bodies.rectangle(rightOuterX - 16, 462, 34, 54, { ...opts, angle: 0.34 }),
      Matter.Bodies.rectangle(septumX + septumHalfW + 10, 466, 26, 42, { ...opts, angle: -0.25 }),
      // Center septum dividing left and right nasal passages
      Matter.Bodies.rectangle(septumX, 312, septumHalfW * 2, 336, opts),
      // Top ceiling cap above sinus
      Matter.Bodies.rectangle(septumX, topY, 260, 24, opts),
      // Invisible side guards below nostril exit
      Matter.Bodies.rectangle(leftOuterX - 20, nostrilExitY + 20, 20, 40, opts),
      Matter.Bodies.rectangle(rightOuterX + 20, nostrilExitY + 20, 20, 40, opts),
    ];

    this.wallBodies.push(...walls);
    Matter.Composite.add(this.engine.world, walls);
  }

  private seedInitialBlockage(): void {
    const { leftCenterX, rightCenterX } = this.t.nose;
    const initial: Array<[number, number, IrritantKind]> = [
      [leftCenterX - 8, 225, 'mucus'],
      [leftCenterX + 10, 285, 'hairball'],
      [leftCenterX - 6, 355, 'pollen'],
      [rightCenterX + 6, 235, 'mucus'],
      [rightCenterX - 8, 300, 'ice'],
      [rightCenterX + 4, 370, 'mucus'],
    ];
    for (const [x, y, kind] of initial) {
      this.spawnIrritant(kind, x, y);
    }
  }

  spawnIrritant(kind: IrritantKind, x: number, y: number): void {
    const spec = this.t.irritants[kind];
    const bodyOpts: Matter.IBodyDefinition = {
      density: spec.density,
      friction: spec.friction,
      frictionStatic: spec.frictionStatic,
      restitution: spec.restitution,
      frictionAir: 0.035,
    };

    const body =
      kind === 'ice'
        ? Matter.Bodies.polygon(x, y, 6, spec.radius, bodyOpts)
        : Matter.Bodies.circle(x, y, spec.radius, bodyOpts);

    Matter.Composite.add(this.engine.world, body);
    this.irritants.push({
      id: this.nextId++,
      kind,
      radius: spec.radius,
      body,
      pollenTimerSec: 0,
    });
  }

  private spawnBurst(x: number, y: number, color: string, count: number, speed = 170): void {
    for (let i = 0; i < count; i++) {
      const ang = Math.random() * Math.PI * 2;
      const spd = 40 + Math.random() * speed;
      this.particles.push({
        x,
        y,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd,
        r: 2.5 + Math.random() * 3,
        color,
        life: 0.45 + Math.random() * 0.25,
        maxLife: 0.7,
      });
    }
  }

  private addFloat(x: number, y: number, text: string, color: string, scale = 1): void {
    this.floats.push({
      x: clamp(x, 64, this.t.view.width - 64),
      y,
      text,
      color,
      scale,
      life: 1.0,
      maxLife: 1.0,
    });
  }

  private irritantColor(kind: IrritantKind): string {
    switch (kind) {
      case 'mucus':
        return '#a3e635';
      case 'hairball':
        return '#a16207';
      case 'pollen':
        return '#facc15';
      case 'ice':
        return '#bae6fd';
    }
  }

  applyRub(x: number, y: number, dx: number, dy: number): boolean {
    if (this.match.finished) return false;
    this.lastActiveSide = x < this.t.nose.septumX ? 'left' : 'right';

    let touched = false;
    for (const item of this.irritants) {
      const dist = Math.hypot(item.body.position.x - x, item.body.position.y - y);
      if (dist <= this.t.skills.rubRadiusPx + item.radius) {
        touched = true;
        const fx = clamp(dx, -22, 22) * this.t.skills.rubForceScale;
        const fy = (clamp(dy, -18, 26) + 4) * this.t.skills.rubForceScale;
        Matter.Body.applyForce(item.body, item.body.position, { x: fx, y: fy });
        Matter.Body.setAngularVelocity(item.body, (Math.random() - 0.5) * 0.25);
      }
    }
    if (touched) {
      this.spawnBurst(x, y, '#e0f2fe', 3, 65);
    }
    return touched;
  }

  triggerSpray(): boolean {
    if (this.match.finished || this.sprayCooldownSec > 0) return false;
    this.sprayCooldownSec = this.t.skills.sprayCooldownSec;
    this.sprayActiveSec = this.t.skills.sprayDurationSec;

    if (this.match.leftAirflowPct < this.match.rightAirflowPct) {
      this.spraySide = 'left';
    } else if (this.match.rightAirflowPct < this.match.leftAirflowPct) {
      this.spraySide = 'right';
    } else {
      this.spraySide = this.lastActiveSide;
    }

    const cx =
      this.spraySide === 'left' ? this.t.nose.leftCenterX : this.t.nose.rightCenterX;
    this.spawnBurst(cx, 175, '#7dd3fc', 14, 150);
    this.addFloat(cx, 185, '盐水冲洗!', '#38bdf8');
    return true;
  }

  triggerMintBomb(): boolean {
    if (this.match.finished || this.mintCooldownSec > 0) return false;
    this.mintCooldownSec = this.t.skills.mintCooldownSec;
    this.mintCalmSec = this.t.skills.mintCalmDurationSec;
    this.shakeMag = Math.max(this.shakeMag, 6);

    // Shatter ice blocks & clear pollen irritation
    for (let i = this.irritants.length - 1; i >= 0; i--) {
      const item = this.irritants[i];
      if (item.kind === 'ice') {
        const res = recordIrritantCleared(this.match, 'ice', this.t);
        this.match = res.state;
        this.spawnBurst(item.body.position.x, item.body.position.y, '#e0f2fe', 14, 180);
        this.addFloat(item.body.position.x, item.body.position.y, `碎冰 +${res.points}`, '#38bdf8');
        Matter.Composite.remove(this.engine.world, item.body);
        this.irritants.splice(i, 1);
      } else {
        item.pollenTimerSec = 0;
        Matter.Body.applyForce(item.body, item.body.position, {
          x: (Math.random() - 0.5) * 0.01,
          y: this.t.skills.mintWaveForce,
        });
      }
    }

    this.addFloat(this.t.nose.septumX, 240, '薄荷暴击!', '#2dd4bf', 1.15);
    return true;
  }

  releaseBlow(): BlowQuality {
    const quality = evaluateBlowStrength(this.blowHoldSec, this.t);
    this.blowHolding = false;
    this.blowHoldSec = 0;

    if (this.match.finished) return quality;

    if (quality === 'max_auto') {
      this.dizzySec = 0.45;
      this.shakeMag = Math.max(this.shakeMag, 4.5);
      this.addFloat(this.t.nose.septumX, 210, '头晕但还是擤出来了!', '#fb923c', 1.1);
    }

    const forceY =
      quality === 'golden'
        ? this.t.skills.blowGoldForce
        : quality === 'normal' || quality === 'max_auto'
          ? this.t.skills.blowNormalForce
          : 0.025;

    if (quality === 'golden') {
      this.shakeMag = Math.max(this.shakeMag, 7.5);
      this.addFloat(this.t.nose.septumX, 250, '黄金猛擤!', '#fde047', 1.2);
    }

    for (let i = this.irritants.length - 1; i >= 0; i--) {
      const item = this.irritants[i];
      if (quality === 'golden' && item.kind === 'ice') {
        const res = recordIrritantCleared(this.match, 'ice', this.t);
        this.match = res.state;
        this.spawnBurst(item.body.position.x, item.body.position.y, '#e0f2fe', 14, 190);
        Matter.Composite.remove(this.engine.world, item.body);
        this.irritants.splice(i, 1);
        continue;
      }
      Matter.Body.applyForce(item.body, item.body.position, {
        x: (Math.random() - 0.5) * 0.008,
        y: forceY,
      });
    }
    return quality;
  }

  private computeSideAirflows(): { leftPct: number; rightPct: number } {
    let leftArea = 0;
    let rightArea = 0;
    for (const item of this.irritants) {
      const area = Math.PI * item.radius * item.radius;
      if (item.body.position.x < this.t.nose.septumX) {
        leftArea += area;
      } else {
        rightArea += area;
      }
    }
    return {
      leftPct: computeAirflowPct(leftArea, this.t),
      rightPct: computeAirflowPct(rightArea, this.t),
    };
  }

  step(dtMs: number): WorldStepEvents {
    const dtSec = Math.min(this.t.loop.maxFrameDtMs, Math.max(0, dtMs)) / 1000;

    // Animate particles & floats
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dtSec;
      p.vy += 320 * dtSec;
      p.x += p.vx * dtSec;
      p.y += p.vy * dtSec;
      if (p.life <= 0) this.particles.splice(i, 1);
    }

    for (let i = this.floats.length - 1; i >= 0; i--) {
      const f = this.floats[i];
      f.life -= dtSec;
      f.y -= 34 * dtSec;
      if (f.life <= 0) this.floats.splice(i, 1);
    }

    this.shakeMag = Math.max(0, this.shakeMag - 26 * dtSec);
    this.dizzySec = Math.max(0, this.dizzySec - dtSec);

    if (this.match.finished) {
      return {
        clearedCountThisStep: 0,
        triggeredClearBurst: false,
        enteredSuffocate: false,
        autoBlowTriggered: false,
      };
    }

    this.sprayCooldownSec = Math.max(0, this.sprayCooldownSec - dtSec);
    this.sprayActiveSec = Math.max(0, this.sprayActiveSec - dtSec);
    this.mintCooldownSec = Math.max(0, this.mintCooldownSec - dtSec);
    this.mintCalmSec = Math.max(0, this.mintCalmSec - dtSec);

    let autoBlowTriggered = false;
    if (this.blowHolding) {
      this.blowHoldSec += dtSec;
      this.noseBlush = Math.min(1, this.blowHoldSec / this.t.skills.blowGoldMaxSec);
      if (this.blowHoldSec >= this.t.skills.blowMaxHoldSec) {
        this.releaseBlow();
        autoBlowTriggered = true;
      }
    } else {
      this.noseBlush = Math.max(0, this.noseBlush - 3.5 * dtSec);
    }

    // Apply spray jet & mint/ice friction modifiers
    const hasLeftIce = this.irritants.some(
      (it) => it.kind === 'ice' && it.body.position.x < this.t.nose.septumX,
    );
    const hasRightIce = this.irritants.some(
      (it) => it.kind === 'ice' && it.body.position.x >= this.t.nose.septumX,
    );

    for (const item of this.irritants) {
      const isLeft = item.body.position.x < this.t.nose.septumX;
      const baseFric = this.t.irritants[item.kind].friction;
      const onSpraySide =
        this.sprayActiveSec > 0 &&
        ((this.spraySide === 'left' && isLeft) || (this.spraySide === 'right' && !isLeft));

      if (this.mintCalmSec > 0 || onSpraySide) {
        item.body.friction = baseFric * 0.22;
      } else if ((isLeft && hasLeftIce) || (!isLeft && hasRightIce)) {
        item.body.friction = Math.min(1.0, baseFric * 1.45);
      } else {
        item.body.friction = baseFric;
      }

      if (onSpraySide) {
        Matter.Body.applyForce(item.body, item.body.position, {
          x: 0,
          y: this.t.skills.sprayForce,
        });
      }

      if (this.match.reliefModeSec > 0) {
        // Fresh air gust clears remaining items out!
        Matter.Body.applyForce(item.body, item.body.position, { x: 0, y: 0.015 });
      }
    }

    // Step Matter.js physics
    Matter.Engine.update(this.engine, dtMs);

    // Check pollen irritation spawn & nostril exits
    let clearedCountThisStep = 0;
    const pollenSpawns: Array<{ x: number; y: number }> = [];

    for (let i = this.irritants.length - 1; i >= 0; i--) {
      const item = this.irritants[i];
      if (item.kind === 'pollen' && this.mintCalmSec <= 0) {
        item.pollenTimerSec += dtSec;
        if (
          item.pollenTimerSec >= this.t.irritants.pollen.irritateSpawnSec &&
          this.irritants.length < 18
        ) {
          item.pollenTimerSec = 0;
          pollenSpawns.push({ x: item.body.position.x, y: item.body.position.y - 14 });
        }
      }

      if (item.body.position.y >= this.t.nose.nostrilExitY) {
        const res = recordIrritantCleared(this.match, item.kind, this.t);
        this.match = res.state;
        clearedCountThisStep += 1;
        this.spawnBurst(
          item.body.position.x,
          this.t.nose.nostrilExitY,
          this.irritantColor(item.kind),
          8,
          165,
        );
        this.addFloat(
          item.body.position.x,
          this.t.nose.nostrilExitY + 12,
          `+${res.points}`,
          '#fde047',
        );
        Matter.Composite.remove(this.engine.world, item.body);
        this.irritants.splice(i, 1);
      }
    }

    for (const pos of pollenSpawns) {
      this.spawnIrritant('mucus', pos.x, pos.y);
    }

    // Spawn new irritants unless in "双孔贯通" relief burst mode
    if (this.match.reliefModeSec <= 0) {
      this.spawnTimerSec -= dtSec;
      if (this.spawnTimerSec <= 0 && this.irritants.length < 18) {
        const kind = pickIrritantKindForWave(this.match.wave);
        const sideLeft = Math.random() < 0.5;
        const baseX = sideLeft ? this.t.nose.leftCenterX : this.t.nose.rightCenterX;
        this.spawnIrritant(
          kind,
          baseX + (Math.random() - 0.5) * 32,
          this.t.nose.sinusY + 12,
        );
        const interval = Math.max(
          this.t.rules.spawnMinIntervalSec,
          this.t.rules.spawnBaseIntervalSec - (this.match.wave - 1) * 0.12,
        );
        this.spawnTimerSec = interval;
      }
    }

    // Step pure match rules
    const flows = this.computeSideAirflows();
    const ruleRes = stepReliefMatch(
      this.match,
      {
        dtSec,
        leftAirflowPct: flows.leftPct,
        rightAirflowPct: flows.rightPct,
      },
      this.t,
    );
    this.match = ruleRes.state;

    if (ruleRes.triggeredClearBurst) {
      this.shakeMag = Math.max(this.shakeMag, 6);
      this.addFloat(
        this.t.nose.septumX,
        210,
        `双孔贯通！神清气爽 ×${this.t.rules.clearMultiplier}`,
        '#38bdf8',
        1.25,
      );
      this.spawnBurst(this.t.nose.leftCenterX, 300, '#e0f2fe', 14, 180);
      this.spawnBurst(this.t.nose.rightCenterX, 300, '#e0f2fe', 14, 180);
    }

    return {
      clearedCountThisStep,
      triggeredClearBurst: ruleRes.triggeredClearBurst,
      enteredSuffocate: ruleRes.enteredSuffocate,
      autoBlowTriggered,
    };
  }
}
