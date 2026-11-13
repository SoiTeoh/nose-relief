import { tuning, type Tuning } from '../config/tuning';
import type { IrritantEntity, NoseReliefWorld } from '../game/world';
import { buildDiagnosisSummary } from '../game/rules';

export interface RenderExtra {
  readonly screenMode: 'title' | 'playing' | 'result';
  readonly bestScore: number;
  readonly muted: boolean;
  readonly debug: boolean;
  readonly animTimeSec: number;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function drawNoseCrossSection(
  ctx: CanvasRenderingContext2D,
  world: NoseReliefWorld,
  t: Tuning,
  animTimeSec: number,
): void {
  const { width, height } = t.view;
  const { septumX, septumHalfW, leftOuterX, rightOuterX, nostrilExitY } = t.nose;
  const { match } = world;
  const inRelief = match.reliefModeSec > 0;

  // Background gradient (cool mint glow during 双孔贯通, dark red tint during suffocation)
  const bg = ctx.createLinearGradient(0, 0, 0, height);
  if (inRelief) {
    bg.addColorStop(0, '#bae6fd');
    bg.addColorStop(1, '#e0f2fe');
  } else if (match.suffocateTimerSec !== null) {
    bg.addColorStop(0, '#fecaca');
    bg.addColorStop(1, '#fef2f2');
  } else {
    bg.addColorStop(0, '#fef3c7');
    bg.addColorStop(1, '#ffedd5');
  }
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  // Outer giant nose silhouette
  ctx.save();
  const blushMix = world.noseBlush > 0.1 || match.suffocateTimerSec !== null;
  ctx.fillStyle = blushMix ? '#fdba74' : '#fed7aa';
  ctx.strokeStyle = '#9a3412';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(148, 86);
  ctx.quadraticCurveTo(70, 220, 48, 390);
  ctx.quadraticCurveTo(36, 485, 118, 496);
  ctx.quadraticCurveTo(195, 504, 272, 496);
  ctx.quadraticCurveTo(354, 485, 342, 390);
  ctx.quadraticCurveTo(320, 220, 242, 86);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Anthropomorphic eyes & eyebrows at top nose bridge (y ≈ 108)
  const eyeY = 112;
  const isStuffed = match.leftAirflowPct < 28 && match.rightAirflowPct < 28;
  for (const side of [-1, 1] as const) {
    const ex = septumX + side * 42;
    ctx.strokeStyle = '#7c2d12';
    ctx.lineWidth = 2.6;
    ctx.lineCap = 'round';

    // Eyebrow
    ctx.beginPath();
    if (inRelief) {
      ctx.moveTo(ex - 10, eyeY - 14);
      ctx.lineTo(ex + 10, eyeY - 14);
    } else if (world.blowHolding || isStuffed) {
      ctx.moveTo(ex - 10, eyeY - 12 - side * 4);
      ctx.lineTo(ex + 10, eyeY - 12 + side * 4);
    } else {
      ctx.moveTo(ex - 10, eyeY - 12);
      ctx.lineTo(ex + 10, eyeY - 10);
    }
    ctx.stroke();

    // Eye expression
    if (inRelief) {
      // ★ ▽ ★
      ctx.fillStyle = '#0284c7';
      ctx.font = '900 18px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('★', ex, eyeY);
    } else if (world.blowHolding || world.dizzySec > 0) {
      // > _ <
      ctx.beginPath();
      if (side === -1) {
        ctx.moveTo(ex - 7, eyeY - 5);
        ctx.lineTo(ex + 6, eyeY);
        ctx.lineTo(ex - 7, eyeY + 5);
      } else {
        ctx.moveTo(ex + 7, eyeY - 5);
        ctx.lineTo(ex - 6, eyeY);
        ctx.lineTo(ex + 7, eyeY + 5);
      }
      ctx.stroke();
    } else if (isStuffed) {
      // Teary - ~ -
      ctx.beginPath();
      ctx.moveTo(ex - 8, eyeY);
      ctx.lineTo(ex + 8, eyeY);
      ctx.stroke();
      ctx.fillStyle = '#38bdf8';
      ctx.beginPath();
      ctx.arc(ex + side * 8, eyeY + 7, 3, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(ex, eyeY, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#0f172a';
      ctx.beginPath();
      ctx.arc(ex, eyeY, 3.8, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Left & right cut-away nasal passages
  const redPulse = 0.55 + 0.45 * Math.sin(animTimeSec * 12);
  for (const [sideSign, cx, xMin, xMax, flow] of [
    [-1, t.nose.leftCenterX, leftOuterX, septumX - septumHalfW, match.leftAirflowPct],
    [1, t.nose.rightCenterX, septumX + septumHalfW, rightOuterX, match.rightAirflowPct],
  ] as const) {
    const lowFlow = flow < 35;
    ctx.fillStyle = world.mintCalmSec > 0 ? '#ccfbf1' : '#ffe4e6';
    roundRect(ctx, xMin, 144, xMax - xMin, nostrilExitY - 144, 18);
    ctx.fill();
    ctx.strokeStyle = lowFlow ? `rgba(239, 68, 68, ${redPulse.toFixed(2)})` : '#fb7185';
    ctx.lineWidth = lowFlow ? 4 : 2;
    ctx.stroke();

    // Turbinate (鼻甲) curved bottleneck bulges matching Matter.js narrowing
    ctx.fillStyle = '#fda4af';
    ctx.strokeStyle = '#e11d48';
    ctx.lineWidth = 1.6;
    const outerWallX = sideSign < 0 ? xMin : xMax;
    ctx.beginPath();
    ctx.arc(outerWallX - sideSign * 4, 342, 34, sideSign < 0 ? -Math.PI * 0.45 : Math.PI * 0.55, sideSign < 0 ? Math.PI * 0.45 : Math.PI * 1.45);
    ctx.fill();
    ctx.stroke();

    // Flowing fresh air lines proportional to airflowPct
    if (flow >= 35) {
      const alpha = (flow / 100) * 0.55;
      ctx.strokeStyle = `rgba(56, 189, 248, ${alpha.toFixed(2)})`;
      ctx.lineWidth = 2.2;
      for (let k = -1; k <= 1; k += 2) {
        const offset = (animTimeSec * (80 + flow * 1.4) + (k > 0 ? 40 : 0)) % 90;
        for (let y = 160 + offset; y < nostrilExitY - 20; y += 90) {
          ctx.beginPath();
          ctx.moveTo(cx + k * 14, y);
          ctx.lineTo(cx + k * 14, y + 26);
          ctx.stroke();
        }
      }
    } else {
      // Flashing low-airflow prompt inside blocked passage
      ctx.save();
      ctx.globalAlpha = 0.65 + 0.35 * Math.sin(animTimeSec * 12);
      ctx.fillStyle = '#dc2626';
      roundRect(ctx, cx - 44, 212, 88, 22, 8);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = '900 11px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('快搓/冲这里！', cx, 223);
      ctx.restore();
    }

    // Narrowed nostril exit rim
    ctx.fillStyle = '#881337';
    ctx.beginPath();
    ctx.ellipse(cx, nostrilExitY, 22, 7, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Saline spray stream visual
  if (world.sprayActiveSec > 0) {
    const sx = world.spraySide === 'left' ? t.nose.leftCenterX : t.nose.rightCenterX;
    const grad = ctx.createLinearGradient(sx, 145, sx, nostrilExitY);
    grad.addColorStop(0, 'rgba(56, 189, 248, 0.75)');
    grad.addColorStop(1, 'rgba(186, 230, 253, 0.15)');
    ctx.fillStyle = grad;
    ctx.fillRect(sx - 18, 145, 36, nostrilExitY - 145);
  }

  // Center Septum wall
  ctx.fillStyle = '#fda4af';
  roundRect(ctx, septumX - septumHalfW, 146, septumHalfW * 2, 334, 10);
  ctx.fill();
  ctx.strokeStyle = '#be123c';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Airflow progress bars above left & right passages
  for (const [bx, label, pct] of [
    [leftOuterX + 4, '左通气', match.leftAirflowPct],
    [septumX + septumHalfW + 4, '右通气', match.rightAirflowPct],
  ] as const) {
    const bw = 96;
    ctx.fillStyle = 'rgba(15, 23, 42, 0.78)';
    roundRect(ctx, bx, 126, bw, 14, 7);
    ctx.fill();
    ctx.fillStyle = pct >= 85 ? '#38bdf8' : pct >= 35 ? '#34d399' : '#ef4444';
    roundRect(ctx, bx + 2, 128, ((bw - 4) * pct) / 100, 10, 5);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = '800 9px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${label} ${pct}%`, bx + bw / 2, 133);
  }

  ctx.restore();
}

function drawIrritant(ctx: CanvasRenderingContext2D, item: IrritantEntity): void {
  const { x, y } = item.body.position;
  const r = item.radius;

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(item.body.angle);

  if (item.kind === 'mucus') {
    ctx.fillStyle = '#84cc16';
    ctx.strokeStyle = '#3f6212';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#ecfccb';
    ctx.beginPath();
    ctx.arc(-r * 0.3, -r * 0.3, r * 0.28, 0, Math.PI * 2);
    ctx.fill();
  } else if (item.kind === 'hairball') {
    ctx.fillStyle = '#92400e';
    ctx.strokeStyle = '#451a03';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // Tangled yarn lines
    ctx.strokeStyle = '#d97706';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(-3, -2, r * 0.55, 0, Math.PI * 1.4);
    ctx.moveTo(-r * 0.6, 3);
    ctx.lineTo(r * 0.6, -4);
    ctx.stroke();
  } else if (item.kind === 'pollen') {
    ctx.fillStyle = '#facc15';
    ctx.strokeStyle = '#a16207';
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r * 0.6, Math.sin(a) * r * 0.6);
      ctx.lineTo(Math.cos(a) * (r + 3.5), Math.sin(a) * (r + 3.5));
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.85, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  } else {
    // Ice polygon
    ctx.fillStyle = 'rgba(186, 230, 253, 0.9)';
    ctx.strokeStyle = '#0284c7';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI) / 3;
      const px = Math.cos(a) * r;
      const py = Math.sin(a) * r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  // Cute mischievous eyes on each irritant
  ctx.fillStyle = '#0f172a';
  ctx.beginPath();
  ctx.arc(-3.5, -1, 1.7, 0, Math.PI * 2);
  ctx.arc(3.5, -1, 1.7, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function drawParticlesAndFloats(ctx: CanvasRenderingContext2D, world: NoseReliefWorld): void {
  for (const p of world.particles) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  for (const f of world.floats) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, f.life / f.maxLife);
    ctx.font = `900 ${Math.round(16 * f.scale)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 4;
    ctx.strokeText(f.text, f.x, f.y);
    ctx.fillStyle = f.color;
    ctx.fillText(f.text, f.x, f.y);
    ctx.restore();
  }
}

function drawHudAndControls(
  ctx: CanvasRenderingContext2D,
  world: NoseReliefWorld,
  extra: RenderExtra,
  t: Tuning,
): void {
  const { width } = t.view;
  const { match } = world;

  // Top HUD bar
  ctx.fillStyle = 'rgba(15, 23, 42, 0.82)';
  roundRect(ctx, 14, 14, width - 28, 48, 14);
  ctx.fill();

  ctx.fillStyle = match.remainingSec <= 10 ? '#fca5a5' : '#ffffff';
  ctx.font = '800 18px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${Math.ceil(match.remainingSec)}s`, 28, 38);

  ctx.fillStyle = '#38bdf8';
  ctx.font = '700 13px sans-serif';
  ctx.fillText(`贯通 ${match.clearComboCount}次`, 86, 38);

  ctx.fillStyle = '#fde047';
  ctx.font = '800 18px sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(`${Math.floor(match.score)}分`, width - 64, 38);

  // Mute button
  ctx.fillStyle = 'rgba(255,255,255,0.14)';
  ctx.beginPath();
  ctx.arc(width - 36, 38, 15, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = '14px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(extra.muted ? '🔇' : '🔊', width - 36, 39);

  // Crisis / Relief banners
  if (match.suffocateTimerSec !== null) {
    ctx.fillStyle = '#ef4444';
    roundRect(ctx, 75, 68, width - 150, 24, 12);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = '900 12px sans-serif';
    ctx.fillText(`窒息倒计时 ${match.suffocateTimerSec.toFixed(1)}s！快疏通！`, width / 2, 80);
  } else if (match.reliefModeSec > 0) {
    ctx.fillStyle = '#0ea5e9';
    roundRect(ctx, 82, 68, width - 164, 24, 12);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = '900 12px sans-serif';
    ctx.fillText(`神清气爽 ×3（${match.reliefModeSec.toFixed(1)}s）`, width / 2, 80);
  }

  if (extra.screenMode !== 'playing') return;

  // Bottom 3 control buttons
  const { spray, blow, mint } = t.buttons;

  // 1. Spray button
  const sprayReady = world.sprayCooldownSec <= 0.01;
  ctx.fillStyle = sprayReady ? '#0ea5e9' : '#475569';
  roundRect(ctx, spray.x - spray.w / 2, spray.y - spray.h / 2, spray.w, spray.h, 14);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = '800 12px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(sprayReady ? '洗鼻水枪 (1)' : `${world.sprayCooldownSec.toFixed(1)}s`, spray.x, spray.y);

  // 2. Center Hold-to-Blow button + lung charge bar
  const blowRatio = Math.min(1, world.blowHoldSec / t.skills.blowMaxHoldSec);
  const inGold =
    world.blowHoldSec >= t.skills.blowGoldMinSec &&
    world.blowHoldSec <= t.skills.blowGoldMaxSec;
  const goldFlash = inGold && Math.sin(extra.animTimeSec * 24) > 0;
  ctx.fillStyle = world.blowHolding
    ? inGold
      ? goldFlash
        ? '#eab308'
        : '#f59e0b'
      : '#f97316'
    : '#ef4444';
  roundRect(ctx, blow.x - blow.w / 2, blow.y - blow.h / 2, blow.w, blow.h, 18);
  ctx.fill();
  ctx.strokeStyle = inGold ? '#fef08a' : '#fecaca';
  ctx.lineWidth = inGold ? 3.5 : 2.5;
  ctx.stroke();

  const blowLabel = !world.blowHolding
    ? '按住蓄力擤'
    : inGold
      ? '快松手猛擤！'
      : world.blowHoldSec > t.skills.blowGoldMaxSec
        ? '即将自动喷！'
        : '蓄力中...';
  ctx.fillStyle = '#ffffff';
  ctx.font = '900 14px sans-serif';
  ctx.fillText(blowLabel, blow.x, blow.y - 6);
  ctx.font = '700 10px sans-serif';
  ctx.fillText('(Space)', blow.x, blow.y + 12);

  // Thicker, prominent lung charge bar right above Blow button
  if (world.blowHolding) {
    const barW = 166;
    const barH = 16;
    const barX = blow.x - barW / 2;
    const barY = blow.y - blow.h / 2 - 22;
    ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
    roundRect(ctx, barX, barY, barW, barH, 8);
    ctx.fill();
    // Gold zone marker
    const gStart = (t.skills.blowGoldMinSec / t.skills.blowMaxHoldSec) * barW;
    const gWidth =
      ((t.skills.blowGoldMaxSec - t.skills.blowGoldMinSec) / t.skills.blowMaxHoldSec) * barW;
    ctx.fillStyle = goldFlash ? 'rgba(254, 240, 138, 0.85)' : 'rgba(250, 204, 21, 0.45)';
    ctx.fillRect(barX + gStart, barY + 1, gWidth, barH - 2);
    ctx.fillStyle = inGold ? (goldFlash ? '#fef08a' : '#fde047') : '#fb7185';
    roundRect(ctx, barX + 1, barY + 1, Math.max(4, (barW - 2) * blowRatio), barH - 2, 7);
    ctx.fill();
    ctx.strokeStyle = inGold ? '#fef08a' : 'rgba(255,255,255,0.45)';
    ctx.lineWidth = inGold ? 2.2 : 1.2;
    roundRect(ctx, barX, barY, barW, barH, 8);
    ctx.stroke();
  }

  // 3. Mint Bomb button
  const mintReady = world.mintCooldownSec <= 0.01;
  ctx.fillStyle = mintReady ? '#10b981' : '#475569';
  roundRect(ctx, mint.x - mint.w / 2, mint.y - mint.h / 2, mint.w, mint.h, 14);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = '800 12px sans-serif';
  ctx.fillText(mintReady ? '薄荷爆弹 (2)' : `${world.mintCooldownSec.toFixed(1)}s`, mint.x, mint.y);
}

function drawTitleOverlay(ctx: CanvasRenderingContext2D, bestScore: number, t: Tuning): void {
  const { width, height } = t.view;
  ctx.fillStyle = 'rgba(15, 23, 42, 0.56)';
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = '#ffffff';
  roundRect(ctx, 26, 110, width - 52, 396, 22);
  ctx.fill();

  ctx.fillStyle = '#0f172a';
  ctx.font = '900 25px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('根治鼻炎通气大师', width / 2, 154);

  ctx.fillStyle = '#475569';
  ctx.font = '600 13px sans-serif';
  ctx.fillText('纯搞笑解压物理游戏 · 目标：双孔贯通神清气爽！', width / 2, 184);

  const tips = [
    ['① 憋红就输', '堵塞物会卡在鼻孔，双孔变红憋气 4.5s 就输'],
    ['② 手搓＋技能', '鼻腔内往下划搓松猫毛；水枪冲最堵；薄荷碎冰花粉'],
    ['③ 双孔爽飙 ×3', '双孔都清到 85% 立刻进入神清气爽 ×3 分！'],
  ];
  tips.forEach(([title, desc], idx) => {
    const ty = 232 + idx * 54;
    ctx.fillStyle = idx === 0 ? '#fef2f2' : idx === 1 ? '#f1f5f9' : '#e0f2fe';
    roundRect(ctx, 38, ty - 16, width - 76, 44, 10);
    ctx.fill();
    ctx.fillStyle = idx === 0 ? '#b91c1c' : idx === 1 ? '#0f172a' : '#0369a1';
    ctx.font = '800 13px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(title, 50, ty);
    ctx.fillStyle = '#475569';
    ctx.font = '600 11px sans-serif';
    ctx.fillText(desc, 50, ty + 18);
  });

  if (bestScore > 0) {
    ctx.fillStyle = '#d97706';
    ctx.font = '700 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`本机最高分：${Math.floor(bestScore)} 分`, width / 2, 400);
  }

  // Start button: x 64..326, y 422..474
  ctx.fillStyle = '#0ea5e9';
  roundRect(ctx, 64, 422, width - 128, 52, 16);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = '900 18px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('开始通气！', width / 2, 454);
}

function drawResultOverlay(
  ctx: CanvasRenderingContext2D,
  world: NoseReliefWorld,
  bestScore: number,
  t: Tuning,
): void {
  const { width, height } = t.view;
  const { match } = world;
  const diag = buildDiagnosisSummary(match);

  ctx.fillStyle = 'rgba(15, 23, 42, 0.64)';
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = '#ffffff';
  roundRect(ctx, 26, 114, width - 52, 412, 22);
  ctx.fill();

  ctx.fillStyle = match.endReason === 'suffocated' ? '#dc2626' : '#0284c7';
  ctx.font = '900 20px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('今日鼻炎诊疗单', width / 2, 152);

  ctx.fillStyle = '#0f172a';
  ctx.font = '800 15px sans-serif';
  ctx.fillText(diag.headline, width / 2, 182);

  ctx.fillStyle = '#ea580c';
  ctx.font = '900 34px sans-serif';
  ctx.fillText(`${Math.floor(match.score)} 分`, width / 2, 226);

  const rows = [
    ['双孔贯通次数', `${match.clearComboCount} 次`],
    ['轰出堵塞物总数', `${match.clearedCount} 个`],
    ['本机最高纪录', `${Math.floor(Math.max(bestScore, match.score))} 分`],
  ];
  rows.forEach(([label, val], idx) => {
    const ry = 274 + idx * 36;
    ctx.fillStyle = '#f8fafc';
    roundRect(ctx, 48, ry - 16, width - 96, 28, 8);
    ctx.fill();
    ctx.fillStyle = '#475569';
    ctx.font = '600 13px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(label, 60, ry);
    ctx.fillStyle = '#0f172a';
    ctx.font = '800 14px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(val, width - 60, ry);
  });

  ctx.fillStyle = '#64748b';
  ctx.font = '600 11.5px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(diag.comment, width / 2, 404);

  // Restart button: x 64..326, y 446..498
  ctx.fillStyle = '#10b981';
  roundRect(ctx, 64, 446, width - 128, 52, 16);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = '900 17px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('再来一疗程 (R)', width / 2, 478);
}

function drawDebugOverlay(
  ctx: CanvasRenderingContext2D,
  world: NoseReliefWorld,
  t: Tuning,
): void {
  // Draw Matter.js wall bounds
  ctx.strokeStyle = 'rgba(34, 211, 238, 0.7)';
  ctx.lineWidth = 1.5;
  for (const w of world.wallBodies) {
    ctx.beginPath();
    w.vertices.forEach((v, idx) => {
      if (idx === 0) ctx.moveTo(v.x, v.y);
      else ctx.lineTo(v.x, v.y);
    });
    ctx.closePath();
    ctx.stroke();
  }

  // Nostril exit sensor line
  ctx.strokeStyle = '#f43f5e';
  ctx.setLineDash([5, 4]);
  ctx.beginPath();
  ctx.moveTo(60, t.nose.nostrilExitY);
  ctx.lineTo(330, t.nose.nostrilExitY);
  ctx.stroke();
  ctx.setLineDash([]);

  // Info box
  ctx.fillStyle = 'rgba(2, 6, 23, 0.8)';
  ctx.fillRect(10, 70, 240, 46);
  ctx.fillStyle = '#22d3ee';
  ctx.font = '11px monospace';
  ctx.textAlign = 'left';
  ctx.fillText(
    `L=${world.match.leftAirflowPct}% R=${world.match.rightAirflowPct}% bodies=${world.irritants.length}`,
    16,
    86,
  );
  ctx.fillText(
    `relief=${world.match.reliefModeSec.toFixed(1)}s suff=${world.match.suffocateTimerSec?.toFixed(1) ?? 'off'}`,
    16,
    102,
  );
}

export function drawGameFrame(
  ctx: CanvasRenderingContext2D,
  world: NoseReliefWorld,
  extra: RenderExtra,
  t: Tuning = tuning,
): void {
  const shakeX = world.shakeMag > 0.2 ? (Math.random() - 0.5) * world.shakeMag * 2 : 0;
  const shakeY = world.shakeMag > 0.2 ? (Math.random() - 0.5) * world.shakeMag * 2 : 0;

  ctx.save();
  ctx.translate(shakeX, shakeY);

  drawNoseCrossSection(ctx, world, t, extra.animTimeSec);

  for (const item of world.irritants) {
    drawIrritant(ctx, item);
  }

  drawParticlesAndFloats(ctx, world);
  ctx.restore();

  drawHudAndControls(ctx, world, extra, t);

  if (extra.debug) {
    drawDebugOverlay(ctx, world, t);
  }

  if (extra.screenMode === 'title') {
    drawTitleOverlay(ctx, extra.bestScore, t);
  } else if (extra.screenMode === 'result') {
    drawResultOverlay(ctx, world, extra.bestScore, t);
  }
}
