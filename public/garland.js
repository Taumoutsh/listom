// Garland separator: a twine hung in five uneven scallops (different widths,
// depths and pin heights), with baubles, gifts and candy canes dangling from
// it. The twine is stretched to the full width; ornaments sit at fixed
// fractions of it, where the curve's height is known, so they stay on the
// string at every width.
(function () {
  "use strict";

  // Pins (x in 0–1000, y in px) and how deep each scallop between two pins
  // sags (y of its curve's control point).
  const PINS = [[0, 5], [170, 11], [390, 3], [560, 13], [790, 6], [1000, 2]];
  const DEPTH = [40, 56, 36, 58, 44];
  const SCALLOPS = DEPTH.map((c, i) => ({ x0: PINS[i][0], y0: PINS[i][1], x1: PINS[i + 1][0], y1: PINS[i + 1][1], c }));
  // A point at fraction t of a scallop (quadratic curve with its control
  // point midway, so x moves linearly with t).
  const at = (s, t) => ({
    x: s.x0 + t * (s.x1 - s.x0),
    y: (1 - t) * (1 - t) * s.y0 + 2 * t * (1 - t) * s.c + t * t * s.y1
  });
  const STRING = "M" + PINS[0].join(" ") + SCALLOPS.map((s) => " Q" + (s.x0 + s.x1) / 2 + " " + s.c + " " + s.x1 + " " + s.y1).join("");

  // Drawings in a single grey (two shades: --garland for shapes, --garland-soft
  // for ribbons, caps and highlights), so the garland reads as a separator.
  const MAIN = "var(--garland)", SOFT = "var(--garland-soft)";

  const bauble = (size) =>
    '<svg viewBox="0 0 32 40" width="' + size + '" height="' + size * 1.25 + '">' +
    '<rect x="12" y="0" width="8" height="6" rx="1.5" fill="' + SOFT + '"/>' +
    '<circle cx="16" cy="22" r="14" fill="' + MAIN + '"/>' +
    '<path d="M3.5 25 q12.5 6 25 0" stroke="' + SOFT + '" stroke-width="2" fill="none"/>' +
    '<path d="M8 17 q3 -6 9 -7" stroke="' + SOFT + '" stroke-width="2.5" stroke-linecap="round" fill="none"/></svg>';

  const gift = (size) =>
    '<svg viewBox="0 0 34 36" width="' + size + '" height="' + size * 36 / 34 + '">' +
    '<path d="M17 9 C12 1 5 3 8 8 C9.5 10 14 10 17 9 Z M17 9 C22 1 29 3 26 8 C24.5 10 20 10 17 9 Z" fill="' + MAIN + '"/>' +
    '<rect x="3" y="12" width="28" height="22" rx="3" fill="' + MAIN + '"/>' +
    '<rect x="1" y="9" width="32" height="7" rx="2" fill="' + MAIN + '"/>' +
    '<rect x="15" y="9" width="4" height="25" fill="' + SOFT + '"/>' +
    '<rect x="1" y="15" width="32" height="2" fill="' + SOFT + '"/></svg>';

  const cane = (size) =>
    '<svg viewBox="0 0 24 46" width="' + size + '" height="' + size * 46 / 24 + '">' +
    '<path d="M18 43 V15 a6 6 0 0 0 -12 0 v3" stroke="' + SOFT + '" stroke-width="6" stroke-linecap="round" fill="none"/>' +
    '<path d="M18 43 V15 a6 6 0 0 0 -12 0 v3" stroke="' + MAIN + '" stroke-width="6" stroke-dasharray="3.5 4" fill="none"/></svg>';

  const star = (size) =>
    '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '">' +
    '<path d="M12 1.5l3.1 6.6 7.2.9-5.3 5 1.4 7.1L12 17.6l-6.4 3.5 1.4-7.1-5.3-5 7.2-.9z" fill="' + MAIN + '"/></svg>';

  // A small fir tree hung by a loop at its tip.
  const tree = (size) =>
    '<svg viewBox="0 0 28 38" width="' + size + '" height="' + size * 38 / 28 + '">' +
    '<circle cx="14" cy="3" r="2.2" fill="none" stroke="' + SOFT + '" stroke-width="1.6"/>' +
    '<path d="M14 5 L21 14 H17.5 L24 23 H19 L27 33 H1 L9 23 H4 L10.5 14 H7 Z" fill="' + MAIN + '"/>' +
    '<path d="M8.5 20 q5.5 3 11 0 M6 29 q8 3.5 16 0" stroke="' + SOFT + '" stroke-width="1.6" stroke-linecap="round" fill="none"/>' +
    '<rect x="12" y="33" width="4" height="5" rx="1" fill="' + SOFT + '"/></svg>';

  const bow = '<svg viewBox="0 0 26 16" width="17" height="11">' +
    '<path d="M13 8 C8 1 1 2 3 8 C1 14 8 15 13 8 Z M13 8 C18 1 25 2 23 8 C25 14 18 15 13 8 Z" fill="' + MAIN + '"/>' +
    '<circle cx="13" cy="8" r="2.6" fill="' + SOFT + '"/></svg>';

  // [scallop index, position in the scallop (0–1), thread length, drawing, extra?]
  // "extra" ornaments only show on wider screens.
  const ORNAMENTS = [
    [0, 0.48, 9, bauble(17)],
    [0, 0.8, 3, star(11), true],
    [1, 0.52, 15, gift(20)],
    [1, 0.8, 3, bauble(11), true],
    [2, 0.45, 5, cane(13)],
    [3, 0.2, 6, tree(16)],
    [3, 0.65, 12, bauble(19)],
    [4, 0.25, 3, cane(9), true],
    [4, 0.55, 8, gift(17)]
  ];

  function garland() {
    let html = '<div class="garland" aria-hidden="true">' +
      '<svg class="garland-string" viewBox="0 0 1000 48" preserveAspectRatio="none">' +
      '<path d="' + STRING + '" class="twine"/><path d="' + STRING + '" class="twine-twist"/></svg>';
    // Little bows where the string is pinned up.
    for (const [x, y] of PINS.slice(1, -1)) html += '<span class="garland-pin" style="left:' + x / 10 + "%;top:" + y + 'px">' + bow + "</span>";
    ORNAMENTS.forEach(([scallop, t, len, svg, extra]) => {
      const p = at(SCALLOPS[scallop], t);
      html += '<span class="ornament' + (extra ? " extra" : "") + '" style="left:' + (p.x / 10).toFixed(2) + "%;top:" + p.y.toFixed(1) +
        "px;--len:" + len + 'px">' + '<span class="thread"></span>' + svg + "</span>";
    });
    return html + "</div>";
  }

  window.ListomGarland = garland;
})();
