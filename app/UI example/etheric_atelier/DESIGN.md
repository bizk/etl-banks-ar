# Design System Strategy: The Digital Atelier (v2.0)

## 1. Overview & Creative North Star: "Precision Organicism"
This design system moves beyond the generic utility of mobile interfaces to embrace the concept of **The Digital Atelier**. Our North Star is **Precision Organicism**—the intersection of high-fashion editorial layout and the mathematical clarity of Apple-inspired minimalism. 

We break the "template" look by rejecting the rigid, boxed-in structures of standard material design. Instead, we use intentional asymmetry, expansive breathing room (whitespace), and a sophisticated hierarchy where the new emerald green (`#10B981`) acts as a precise surgical strike of color against a canvas of gallery-grade neutrals. This is not just a UI; it is a curated space where content is treated as art.

---

## 2. Color Theory: The Emerald Core
The palette is anchored by a vibrant, high-energy emerald, balanced by a sophisticated grayscale that favors "Surface" over "Structure."

### The Primary Signature
*   **Primary (`#006C49`) / Primary Container (`#10B981`):** Use the vibrant Emerald (`#10B981`) for high-intent actions. It represents growth and digital vitality.
*   **Tonal Depth:** Use `on-primary-container` (`#00422B`) for text sitting atop the emerald to ensure AAA accessibility while maintaining a lush, monochromatic look.

### The "No-Line" Rule
**Explicit Instruction:** Designers are prohibited from using 1px solid borders to section content. 
*   **Definition through Shift:** Boundaries must be defined solely through background color shifts. For example, a `surface-container-low` section sitting on a `surface` background creates a soft, sophisticated edge that feels "architectural" rather than "drawn."

### Surface Hierarchy & Nesting
Treat the UI as a series of physical layers—stacked sheets of fine vellum or frosted glass. 
*   **Base:** `surface` (`#f8f9fa`)
*   **Secondary Content:** `surface-container-low` (`#f3f4f5`)
*   **Interactive Cards:** `surface-container-lowest` (`#ffffff`) to create a "lifted" appearance without shadows.

### Signature Textures: The "Glass & Gradient" Rule
To avoid a flat, "out-of-the-box" feel, use **Glassmorphism** for floating headers or navigation bars. Apply a 20px backdrop-blur to `surface` at 80% opacity. For CTAs, apply a subtle linear gradient from `primary` to `primary-container` at a 135-degree angle to give the Emerald a "jewel-toned" soul.

---

## 3. Typography: Editorial Authority
We utilize a dual-font strategy to balance character with readability.

*   **Display & Headlines (Manrope):** Chosen for its geometric precision. Use `display-lg` (3.5rem) with tight tracking (-0.02em) for hero sections to create an editorial, high-fashion impact.
*   **Body & Labels (Inter):** The workhorse. Inter provides maximum legibility at small scales. Use `body-md` (0.875rem) for general prose to maintain a light, airy feel.
*   **Hierarchy as Identity:** Always favor a large contrast between headlines and body text. A `headline-lg` should feel significantly more authoritative than the `title-sm` beneath it, creating a clear "entry point" for the eye.

---

## 4. Elevation & Depth: Tonal Layering
Traditional drop shadows are often a crutch for poor layout. In this system, we prioritize **Tonal Layering**.

*   **The Layering Principle:** Place a `surface-container-lowest` (pure white) card on a `surface-container-low` (light grey) background. This creates a "Natural Lift."
*   **Ambient Shadows:** If a floating element (like a FAB or Menu) requires a shadow, it must be "Ambient":
    *   **Blur:** 40px to 60px.
    *   **Opacity:** 4%–6%.
    *   **Color:** Use a tinted version of `on-surface` (e.g., `#191C1D` at 5% opacity).
*   **The Ghost Border Fallback:** If accessibility requires a border, use the `outline-variant` token at **15% opacity**. Never use a 100% opaque border.

---

## 5. Components: The Primitive Set

### Buttons (The Interaction Pillars)
*   **Primary:** Solid `primary-container` (`#10B981`) with `on-primary-container` text. Radius: `md` (0.75rem).
*   **Secondary:** `surface-container-high` background with `primary` text. No border.
*   **Tertiary:** Text-only in `primary` weight, used for low-emphasis actions.

### Input Fields
*   **Style:** Minimalist underline or soft tonal background (`surface-container-low`). 
*   **Active State:** The label transitions to `primary` (Emerald), and a 2px bottom-bar in `primary` expands from the center.
*   **Error:** Use `error` (`#ba1a1a`) strictly for the indicator and helper text.

### Cards & Lists
*   **The Divider Ban:** Do not use line dividers between list items. Use the **Spacing Scale** `spacing-4` (1.4rem) to create separation through "passive space."
*   **Selection States:** Selected cards should use a subtle `secondary-container` (`#adedd3`) fill or a `primary` "Ghost Border" (20% opacity).

### Progress Bars & Active States
*   **Track:** `surface-container-highest`.
*   **Indicator:** A gradient transition from `primary` to `primary-fixed`. 
*   **Glow:** Active states (like a toggle being 'On') should have a faint Emerald outer-glow using a 4px blur of the primary color at 20% opacity.

---

## 6. Do’s and Don’ts

### Do:
*   **Do** use asymmetrical margins. If the left margin is `spacing-6`, try a right margin of `spacing-8` for editorial layouts.
*   **Do** use `primary-container` (`#10B981`) for all "Success" states and "Submit" actions.
*   **Do** prioritize vertical white space. When in doubt, add more air.

### Don’t:
*   **Don’t** use pure black (`#000000`) for text. Use `on-surface` (`#191C1D`) to maintain the "Atelier" softness.
*   **Don’t** use standard 4px "Material" corners. Use our `md` (0.75rem) or `lg` (1rem) for a more premium, "squircle" feel.
*   **Don’t** stack more than three layers of surface containers. It muddies the visual hierarchy.

---

## 7. Spacing Scale Reference
*   **Micro (0.5 - 2):** For internal component padding (e.g., button label padding).
*   **Macro (6 - 12):** For section spacing and layout gutters.
*   **Hero (16 - 24):** For dramatic top-of-page offsets and editorial breathing room.