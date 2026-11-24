// Themed decorations of a list page: the garland separator (one grey tone) and
// the two charms hanging over the list's picture (in colour). Themes:
// "noel" (baubles, gifts, candy canes, fir tree), "anniversaire" (cakes,
// candles, gifts) and "mariage" (wedding rings, gifts, hearts).
(function () {
  "use strict";

  // ---- Garland geometry: a twine hung in five uneven scallops ---------------
  // Pins (x in 0–1000, y in px) and how deep each scallop between two pins
  // sags (y of its curve's control point). Ornaments sit at fixed fractions of
  // a scallop, where the curve's height is known, so they stay on the string
  // at every width.
  const PINS = [[0, 5], [170, 11], [390, 3], [560, 13], [790, 6], [1000, 2]];
  const DEPTH = [40, 56, 36, 58, 44];
  const SCALLOPS = DEPTH.map((c, i) => ({ x0: PINS[i][0], y0: PINS[i][1], x1: PINS[i + 1][0], y1: PINS[i + 1][1], c }));
  const at = (s, t) => ({
    x: s.x0 + t * (s.x1 - s.x0),
    y: (1 - t) * (1 - t) * s.y0 + 2 * t * (1 - t) * s.c + t * t * s.y1
  });
  const STRING = "M" + PINS[0].join(" ") + SCALLOPS.map((s) => " Q" + (s.x0 + s.x1) / 2 + " " + s.c + " " + s.x1 + " " + s.y1).join("");

  // ---- Garland drawings, single grey (two shades) ----------------------------
  const MAIN = "var(--garland)", SOFT = "var(--garland-soft)";
  const svg = (w, h, vw, vh, body) => '<svg viewBox="0 0 ' + vw + " " + vh + '" width="' + w + '" height="' + h + '">' + body + "</svg>";

  const bauble = (s) => svg(s, s * 1.25, 32, 40,
    '<rect x="12" y="0" width="8" height="6" rx="1.5" fill="' + SOFT + '"/><circle cx="16" cy="22" r="14" fill="' + MAIN + '"/>' +
    '<path d="M3.5 25 q12.5 6 25 0" stroke="' + SOFT + '" stroke-width="2" fill="none"/><path d="M8 17 q3 -6 9 -7" stroke="' + SOFT + '" stroke-width="2.5" stroke-linecap="round" fill="none"/>');
  const gift = (s) => svg(s, s * 36 / 34, 34, 36,
    '<path d="M17 9 C12 1 5 3 8 8 C9.5 10 14 10 17 9 Z M17 9 C22 1 29 3 26 8 C24.5 10 20 10 17 9 Z" fill="' + MAIN + '"/>' +
    '<rect x="3" y="12" width="28" height="22" rx="3" fill="' + MAIN + '"/><rect x="1" y="9" width="32" height="7" rx="2" fill="' + MAIN + '"/>' +
    '<rect x="15" y="9" width="4" height="25" fill="' + SOFT + '"/><rect x="1" y="15" width="32" height="2" fill="' + SOFT + '"/>');
  const cane = (s) => svg(s, s * 46 / 24, 24, 46,
    '<path d="M18 43 V15 a6 6 0 0 0 -12 0 v3" stroke="' + SOFT + '" stroke-width="6" stroke-linecap="round" fill="none"/>' +
    '<path d="M18 43 V15 a6 6 0 0 0 -12 0 v3" stroke="' + MAIN + '" stroke-width="6" stroke-dasharray="3.5 4" fill="none"/>');
  const star = (s) => svg(s, s, 24, 24, '<path d="M12 1.5l3.1 6.6 7.2.9-5.3 5 1.4 7.1L12 17.6l-6.4 3.5 1.4-7.1-5.3-5 7.2-.9z" fill="' + MAIN + '"/>');
  const tree = (s) => svg(s, s * 38 / 28, 28, 38,
    '<circle cx="14" cy="3" r="2.2" fill="none" stroke="' + SOFT + '" stroke-width="1.6"/>' +
    '<path d="M14 5 L21 14 H17.5 L24 23 H19 L27 33 H1 L9 23 H4 L10.5 14 H7 Z" fill="' + MAIN + '"/>' +
    '<path d="M8.5 20 q5.5 3 11 0 M6 29 q8 3.5 16 0" stroke="' + SOFT + '" stroke-width="1.6" stroke-linecap="round" fill="none"/>' +
    '<rect x="12" y="33" width="4" height="5" rx="1" fill="' + SOFT + '"/>');
  // Birthday: a two-tier cake with one candle, and a striped candle.
  const cake = (s) => svg(s, s * 36 / 30, 30, 36,
    '<path d="M15 0.5 C17.4 3.5 17.4 6 15 7 C12.6 6 12.6 3.5 15 0.5 Z" fill="' + SOFT + '"/>' +
    '<rect x="13.6" y="7" width="2.8" height="7" rx="1" fill="' + MAIN + '"/>' +
    '<rect x="6" y="14" width="18" height="8" rx="2" fill="' + MAIN + '"/><path d="M6 16.5 q3 3 6 0 t6 0 t6 0" stroke="' + SOFT + '" stroke-width="1.6" fill="none"/>' +
    '<rect x="2" y="22" width="26" height="10" rx="2.5" fill="' + MAIN + '"/><path d="M2 25 q3.25 3 6.5 0 t6.5 0 t6.5 0 t6.5 0" stroke="' + SOFT + '" stroke-width="1.6" fill="none"/>' +
    '<rect x="0" y="32.5" width="30" height="3" rx="1.5" fill="' + SOFT + '"/>');
  const candle = (s) => svg(s, s * 36 / 12, 12, 36,
    '<path d="M6 0.5 C8.6 3.8 8.6 6.4 6 7.6 C3.4 6.4 3.4 3.8 6 0.5 Z" fill="' + SOFT + '"/>' +
    '<rect x="3" y="8.5" width="6" height="27" rx="1.6" fill="' + MAIN + '"/>' +
    '<path d="M3 14 l6 -3.5 M3 20 l6 -3.5 M3 26 l6 -3.5 M3 32 l6 -3.5" stroke="' + SOFT + '" stroke-width="1.7"/>');
  // Wedding: two interlaced rings (one with a stone), and a heart.
  const rings = (s) => svg(s, s * 28 / 36, 36, 28,
    '<path d="M13 1 l3.2 3.2 -3.2 3.2 -3.2 -3.2 Z" fill="' + SOFT + '"/>' +
    '<circle cx="13" cy="17" r="9" stroke="' + MAIN + '" stroke-width="3.4" fill="none"/>' +
    '<circle cx="23" cy="17" r="9" stroke="' + MAIN + '" stroke-width="3.4" fill="none"/>' +
    '<path d="M18.6 10.2 a9 9 0 0 1 0 13.6" stroke="' + SOFT + '" stroke-width="1.4" fill="none"/>');
  const heart = (s) => svg(s, s * 22 / 24, 24, 22, '<path d="M12 21 C3 14.5 0.5 10 0.5 6.5 A5.5 5.5 0 0 1 12 4.5 A5.5 5.5 0 0 1 23.5 6.5 C23.5 10 21 14.5 12 21 Z" fill="' + MAIN + '"/>');

  const bow = svg(17, 11, 26, 16,
    '<path d="M13 8 C8 1 1 2 3 8 C1 14 8 15 13 8 Z M13 8 C18 1 25 2 23 8 C25 14 18 15 13 8 Z" fill="' + MAIN + '"/><circle cx="13" cy="8" r="2.6" fill="' + SOFT + '"/>');
  const pinHeart = heart(12);

  // [scallop, position in it (0–1), thread length, drawing, extra?] — "extra"
  // ornaments only show on wider screens.
  const LAYOUTS = {
    noel: { pin: bow, items: [
      [0, 0.48, 9, bauble(17)], [0, 0.8, 3, star(11), true], [1, 0.52, 15, gift(20)], [1, 0.8, 3, bauble(11), true],
      [2, 0.45, 5, cane(13)], [3, 0.2, 6, tree(16)], [3, 0.65, 12, bauble(19)], [4, 0.25, 3, cane(9), true], [4, 0.55, 8, gift(17)]
    ] },
    anniversaire: { pin: bow, items: [
      [0, 0.48, 9, cake(19)], [0, 0.8, 3, candle(6), true], [1, 0.52, 15, gift(20)], [1, 0.8, 3, cake(12), true],
      [2, 0.45, 5, candle(8)], [3, 0.2, 6, gift(14)], [3, 0.65, 12, cake(20)], [4, 0.25, 3, candle(6), true], [4, 0.55, 8, gift(17)]
    ] },
    mariage: { pin: pinHeart, items: [
      [0, 0.48, 9, rings(24)], [0, 0.8, 3, heart(10), true], [1, 0.52, 15, gift(20)], [1, 0.8, 3, rings(15), true],
      [2, 0.45, 5, heart(13)], [3, 0.2, 6, gift(14)], [3, 0.65, 12, rings(24)], [4, 0.25, 3, heart(10), true], [4, 0.55, 8, gift(17)]
    ] }
  };

  function garland(theme) {
    const layout = LAYOUTS[theme] || LAYOUTS.noel;
    let html = '<div class="garland" aria-hidden="true">' +
      '<svg class="garland-string" viewBox="0 0 1000 48" preserveAspectRatio="none">' +
      '<path d="' + STRING + '" class="twine"/><path d="' + STRING + '" class="twine-twist"/></svg>';
    for (const [x, y] of PINS.slice(1, -1)) html += '<span class="garland-pin" style="left:' + x / 10 + "%;top:" + y + 'px">' + layout.pin + "</span>";
    for (const [scallop, t, len, drawing, extra] of layout.items) {
      const p = at(SCALLOPS[scallop], t);
      html += '<span class="ornament' + (extra ? " extra" : "") + '" style="left:' + (p.x / 10).toFixed(2) + "%;top:" + p.y.toFixed(1) +
        "px;--len:" + len + 'px"><span class="thread"></span>' + drawing + "</span>";
    }
    return html + "</div>";
  }

  // ---- Charms over the list's picture (in colour, viewBox 0 0 120 120) -----------
  // Each hangs from a string at x=14 (left) and x=106 (right), and sways
  // gently (classes "bauble" / "bauble b2", see styles.css).
  const string = (x, len) => '<path d="M' + x + " -6v" + len + '" stroke="var(--muted)" stroke-width="1.5"/>';
  const CHARMS = {
    noel:
      '<g class="bauble">' + string(14, 20) + '<rect x="10" y="13" width="8" height="5" rx="1" fill="#C9A227"/><circle cx="14" cy="26" r="9" fill="#D6336C"/><path d="M9 23q5-4 10 0" stroke="#fff" stroke-width="1.5" fill="none" opacity=".7"/></g>' +
      '<g class="bauble b2">' + string(106, 26) + '<rect x="102" y="19" width="8" height="5" rx="1" fill="#C9A227"/><circle cx="106" cy="32" r="8" fill="#E5B54C"/><path d="M101 29q5-4 10 0" stroke="#fff" stroke-width="1.5" fill="none" opacity=".7"/></g>',
    // A pink-iced cake on the left, a smaller golden one on the right, each with a lit candle.
    anniversaire:
      '<g class="bauble">' + string(14, 12) + '<g transform="translate(14 18.5) scale(1.3) translate(-14 -18.5)"><path d="M14 8.5 c2 2.4 2 4.2 0 5 c-2 -0.8 -2 -2.6 0 -5z" fill="#F59F00"/><rect x="13" y="13.5" width="2" height="5" rx=".6" fill="#E5B54C"/>' +
        '<rect x="4" y="18.5" width="20" height="13" rx="2.5" fill="#F4D9B5"/><path d="M4 21.5 q2.5 3 5 0 t5 0 t5 0 t5 0 V20.5 a2.5 2.5 0 0 0 -2.5 -2 H6.5 a2.5 2.5 0 0 0 -2.5 2 z" fill="#D6336C"/>' +
        '<rect x="2" y="31" width="24" height="2.4" rx="1.2" fill="#C9A227"/></g></g>' +
      '<g class="bauble b2">' + string(106, 18.5) + '<g transform="translate(106 23.5) scale(1.3) translate(-106 -23.5)"><path d="M106 15 c1.7 2 1.7 3.6 0 4.3 c-1.7 -0.7 -1.7 -2.3 0 -4.3z" fill="#F59F00"/><rect x="105.2" y="19.3" width="1.6" height="4.2" rx=".5" fill="#D6336C"/>' +
        '<rect x="98.5" y="23.5" width="15" height="10" rx="2" fill="#F4D9B5"/><path d="M98.5 26 q1.9 2.4 3.75 0 t3.75 0 t3.75 0 t3.75 0 V25.5 a2 2 0 0 0 -2 -2 H100.5 a2 2 0 0 0 -2 2 z" fill="#E5B54C"/>' +
        '<rect x="97" y="33" width="18" height="2" rx="1" fill="#C9A227"/></g></g>',
    // Two golden interlaced rings on the left, a single ring with its stone on the right.
    mariage:
      '<g class="bauble">' + string(14, 13) + '<g transform="translate(14 17) scale(1.3) translate(-14 -17)"><circle cx="10" cy="24" r="6.5" stroke="#C9A227" stroke-width="2.6" fill="none"/><circle cx="18" cy="24" r="6.5" stroke="#E5B54C" stroke-width="2.6" fill="none"/>' +
        '<path d="M14 9 l2.2 2.4 -2.2 2.4 -2.2 -2.4z" fill="#D6336C"/></g></g>' +
      '<g class="bauble b2">' + string(106, 19.5) + '<g transform="translate(106 22) scale(1.3) translate(-106 -22)"><path d="M106 15.5 l2.6 2.6 -2.6 2.6 -2.6 -2.6z" fill="#E8E4F5" stroke="#B3AFC0" stroke-width=".8"/>' +
        '<circle cx="106" cy="28" r="6.5" stroke="#E5B54C" stroke-width="2.6" fill="none"/></g></g>'
  };
  const charms = (theme) => '<svg class="baubles" viewBox="0 0 120 120" aria-hidden="true">' + (CHARMS[theme] || CHARMS.noel) + "</svg>";

  window.ListomGarland = garland;
  window.ListomCharms = charms;
})();
