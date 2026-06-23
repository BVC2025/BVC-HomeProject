// =====================================================================
// BOM material icon helper
//
// When a BOM line has no uploaded image, we render a category-based
// colored icon tile instead of a plain "📷" placeholder. The category
// is detected by keyword matching against the material name, so the
// same material picks the same icon everywhere (Project drawer +
// Production page).
//
// Add new categories by inserting a row before MATERIAL_CATEGORIES_DEFAULT —
// first-match wins, so put more-specific patterns higher up.
// =====================================================================


const MATERIAL_CATEGORIES = [
  {
    label: "Fastener",
    test: /\b(screw|bolt|nut|rivet|fastener|washer)\b/i,
    icon: "🔩",
    bg: "linear-gradient(135deg, #94a3b8, #475569)",
    fg: "#ffffff",
    border: "#334155"
  },
  {
    label: "Motor / Spring",
    test: /\b(motor|spring|servo|compressor|samp)\b/i,
    icon: "⚙️",
    bg: "linear-gradient(135deg, #818cf8, #4338ca)",
    fg: "#ffffff",
    border: "#3730a3"
  },
  {
    label: "Glass / Display",
    test: /\b(glass|touchscreen|display|screen|window|mirror)\b/i,
    icon: "🪟",
    bg: "linear-gradient(135deg, #60a5fa, #1e40af)",
    fg: "#ffffff",
    border: "#1e3a8a"
  },
  {
    label: "Lock / Hinge",
    test: /\b(lock|hinge|key|bush)\b/i,
    icon: "🔐",
    bg: "linear-gradient(135deg, #fbbf24, #b45309)",
    fg: "#ffffff",
    border: "#92400e"
  },
  {
    label: "Door",
    test: /\b(door)\b/i,
    icon: "🚪",
    bg: "linear-gradient(135deg, #f59e0b, #dc2626)",
    fg: "#ffffff",
    border: "#78350f"
  },
  {
    label: "Wheel / Rail",
    test: /\b(wheel|roller|rail|slide|patta)\b/i,
    icon: "🛞",
    bg: "linear-gradient(135deg, #475569, #0f172a)",
    fg: "#ffffff",
    border: "#0f172a"
  },
  {
    label: "Wiring / Electric",
    test: /\b(wire|harness|cable|wiring|led|electric)\b/i,
    icon: "⚡",
    bg: "linear-gradient(135deg, #fb923c, #c2410c)",
    fg: "#ffffff",
    border: "#9a3412"
  },
  {
    label: "Electronics / Sensor",
    test: /\b(sensor|board|control|payment|battery|ups|terminal|rtc|pcb|module)\b/i,
    icon: "💡",
    bg: "linear-gradient(135deg, #a78bfa, #6d28d9)",
    fg: "#ffffff",
    border: "#5b21b6"
  },
  {
    label: "Rubber / Seal",
    test: /\b(rubber|beading|seal|gasket|silicone)\b/i,
    icon: "🟫",
    bg: "linear-gradient(135deg, #d6a675, #92400e)",
    fg: "#ffffff",
    border: "#78350f"
  },
  {
    label: "Tray / Box",
    test: /\b(tray|box|container|drag|crate|bin|locker|compartment)\b/i,
    icon: "📦",
    bg: "linear-gradient(135deg, #2dd4bf, #0f766e)",
    fg: "#ffffff",
    border: "#115e59"
  },
  {
    label: "Refrigeration",
    test: /\b(refrig|cool|heating|element|pid|thermal|atomizer|humidity|temperature)\b/i,
    icon: "❄️",
    bg: "linear-gradient(135deg, #67e8f9, #0e7490)",
    fg: "#ffffff",
    border: "#155e75"
  },
  {
    label: "Sheet Metal / Cabinet",
    test: /\b(cabin|cabinet|plate|sheet|stiffner|stiffener|cover|frame|side|piller|pillar|clamp|fab|fr\.plat|ru\.be|inter|stainless)\b/i,
    icon: "🔲",
    bg: "linear-gradient(135deg, #cbd5e1, #64748b)",
    fg: "#0f172a",
    border: "#475569"
  },
  {
    label: "Lever / Link",
    test: /\b(lever|link|rod|arm|patta)\b/i,
    icon: "🔗",
    bg: "linear-gradient(135deg, #a3a3a3, #525252)",
    fg: "#ffffff",
    border: "#404040"
  },
  {
    label: "CVM Assembly",
    test: /\b(cvm|assembly|base)\b/i,
    icon: "🏭",
    bg: "linear-gradient(135deg, #ef4444, #dc2626)",
    fg: "#ffffff",
    border: "#9d174d"
  }
];


const MATERIAL_CATEGORY_DEFAULT = {
  label: "Component",
  icon: "🔧",
  bg: "linear-gradient(135deg, #e2e8f0, #94a3b8)",
  fg: "#0f172a",
  border: "#64748b"
};


/**
 * Returns {icon, bg, fg, border, label} for a BOM material name.
 * First keyword match wins; never returns null.
 */
export function getMaterialIcon(name) {

  const text = (name || "").toString();

  for (const cat of MATERIAL_CATEGORIES) {

    if (cat.test.test(text)) {

      return cat;
    }
  }

  return MATERIAL_CATEGORY_DEFAULT;
}


/**
 * Render a styled placeholder tile for a BOM row when no image is
 * uploaded. `size` controls both width and height (square tile).
 */
export function bomIconTileStyle(name, size = 56) {

  const cat = getMaterialIcon(name);

  return {
    container: {
      width: size,
      height: size,
      background: cat.bg,
      borderRadius: 10,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: Math.round(size * 0.45),
      color: cat.fg,
      border: `1px solid ${cat.border}`,
      boxShadow: "0 2px 8px rgba(15, 23, 42, 0.12)",
      flexShrink: 0
    },
    icon: cat.icon,
    label: cat.label
  };
}
