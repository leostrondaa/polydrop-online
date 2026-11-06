// Motor único de contato entre molécula e linhas VISÍVEIS do béquer.
// Usado por navegador e servidor para validar a mesma geometria.
// Coordenadas normalizadas por pista; as distâncias são convertidas para
// unidades de raio de bolinha, preservando formato circular em qualquer tela.
(function (root, factory) {
  const collision = factory();
  if (typeof module === 'object' && module.exports) module.exports = collision;
  else root.PolyDropCollision = collision;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const CATCH_Y = 0.81;
  // Raio de captura 1px menor que o desenho: um quase-toque não conta.
  function geometryForLane(w, h) {
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
    const cw = Math.max(33, Math.min(65, w * .14));
    const ch = Math.max(28, Math.min(53, h * .115));
    const radius = Math.max(21, Math.min(31, w * .084, h * .056));
    const hitRadius = Math.max(1, radius - 1);
    return {
      barHalfX: cw * .34 / w,
      barY: -1 / h,
      sideTopHalfX: cw * .5 / w,
      sideBottomHalfX: cw * .43 / w,
      sideDepth: ch * .85 / h,
      dropRx: hitRadius / w,
      dropRy: hitRadius / h
    };
  }
  // Distância mínima entre o centro da bolinha e um dos segmentos desenhados.
  // O béquer nunca varre o trajeto entre a posição anterior e a posição atual.
  function circleTouchesSegment(px, py, ax, ay, bx, by, rx, ry) {
    const vx = (bx - ax) / rx, vy = (by - ay) / ry;
    const wx = (px - ax) / rx, wy = (py - ay) / ry;
    const den = vx*vx + vy*vy;
    const t = den > 0 ? clamp((wx*vx + wy*vy) / den, 0, 1) : 0;
    const dx = wx - t*vx, dy = wy - t*vy;
    return dx*dx + dy*dy <= 1;
  }
  function touchesCup(cupX, dropX, dropY, g) {
    if (!g || !Number.isFinite(cupX) || !Number.isFinite(dropX) || !Number.isFinite(dropY)) return false;
    const rx = g.dropRx, ry = g.dropRy;
    if (!(rx > 0 && ry > 0)) return false;
    const x = dropX - cupX, y = dropY - CATCH_Y;
    // Linha iluminada da boca; apenas as duas paredes de fato desenhadas.
    if (circleTouchesSegment(x,y,-g.barHalfX,g.barY,g.barHalfX,g.barY,rx,ry)) return true;
    if (circleTouchesSegment(x,y,-g.sideTopHalfX,0,-g.sideBottomHalfX,g.sideDepth,rx,ry)) return true;
    return circleTouchesSegment(x,y,g.sideTopHalfX,0,g.sideBottomHalfX,g.sideDepth,rx,ry);
  }
  return {geometryForLane, touchesCup, CATCH_Y};
});
