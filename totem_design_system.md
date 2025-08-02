# TOTeM Tool Design System

## Core Actor Colors
These five colors are specifically chosen for optimal differentiation in graphs and charts while maintaining visual harmony:

### Primary Object Type Colors
1. **Deep Blue** - `#2563EB`
2. **Emerald Green** - `#10B981` 
3. **Amber Orange** - `#F59E0B` 
4. **Purple** - `#8B5CF6`
5. **Rose** - `#F43F5E` 

### Color Properties
- **High contrast ratio** for accessibility
- **Distinct hues** to avoid confusion in colorblind users
- **Balanced saturation** to work well in both light and dark backgrounds
- **Professional appearance** suitable for healthcare and business contexts

## Typography

### Primary Font: **Inter**
- **Usage**: Headers, UI elements, body text
- **Weights**: 300 (Light), 400 (Regular), 500 (Medium), 600 (SemiBold), 700 (Bold)
- **Rationale**: Excellent readability, modern appearance, optimized for digital interfaces

### Secondary Font: **JetBrains Mono**
- **Usage**: Code snippets, data values, technical annotations
- **Weights**: 400 (Regular), 500 (Medium), 700 (Bold)
- **Rationale**: Monospace font ideal for data display and technical content

## Logo Design Concept

### TOTeM Logo Colors
- **Primary**: `#1E293B` (Slate Gray) - Professional, stable
- **Accent**: `#2563EB` (Deep Blue) - Matches primary actor color
- **Highlight**: `#F59E0B` (Amber) - Adds warmth and energy

The logo is still in the making ...

## Dashboard Color Palette

### Background Colors
- **Primary Background**: `#FFFFFF` (White)
- **Secondary Background**: `#F8FAFC` (Light Gray)
- **Card Background**: `#FFFFFF` with `border: 1px solid #E2E8F0`
- **Sidebar Background**: `#1E293B` (Dark Slate)

### UI Element Colors
- **Text Primary**: `#0F172A` (Near Black)
- **Text Secondary**: `#64748B` (Gray)
- **Text Muted**: `#94A3B8` (Light Gray)
- **Borders**: `#E2E8F0` (Light Border)
- **Dividers**: `#CBD5E1` (Medium Border)

### Interactive Elements
- **Primary Button**: `#2563EB` (Deep Blue)
- **Primary Button Hover**: `#1D4ED8`
- **Secondary Button**: `#F1F5F9` (Light Gray)
- **Success**: `#10B981` (Emerald)
- **Warning**: `#F59E0B` (Amber)
- **Error**: `#EF4444` (Red)
- **Info**: `#3B82F6` (Blue)

## Chart and Visualization Colors

### Primary Chart Colors (for multi-series data)
Use the 5 actor colors in this order:
1. `#2563EB` (Deep Blue)
2. `#10B981` (Emerald Green)
3. `#F59E0B` (Amber Orange)
4. `#8B5CF6` (Purple)
5. `#F43F5E` (Rose)

### Extended Palette (for additional data series)
6. `#06B6D4` (Cyan)
7. `#84CC16` (Lime)
8. `#F97316` (Orange)
9. `#EC4899` (Pink)
10. `#6366F1` (Indigo)

### Monochromatic Scales
For single-series visualizations or heatmaps:

**Blue Scale**: `#EFF6FF` → `#DBEAFE` → `#BFDBFE` → `#93C5FD` → `#60A5FA` → `#3B82F6` → `#2563EB` → `#1D4ED8`

**Gray Scale**: `#F8FAFC` → `#F1F5F9` → `#E2E8F0` → `#CBD5E1` → `#94A3B8` → `#64748B` → `#475569` → `#334155`

## Layout and Spacing

### Grid System
- **Container Max Width**: 1200px
- **Columns**: 12-column grid
- **Gutter**: 24px
- **Margins**: 24px (mobile), 48px (desktop)

### Spacing Scale
- **XS**: 4px
- **SM**: 8px
- **MD**: 16px
- **LG**: 24px
- **XL**: 32px
- **2XL**: 48px
- **3XL**: 64px

## Accessibility Guidelines

### Color Contrast
- All text maintains WCAG AA compliance (4.5:1 contrast ratio minimum)
- Interactive elements have clear focus states
- Color is never the only way to convey information

### Alternative Representations
- Use patterns or shapes alongside colors in charts
- Provide data labels and tooltips
- Include legends and clear labeling

## Usage Examples

### Dashboard Components
- **KPI cards**: White background with colored accent borders
- **Navigation**: Dark sidebar with blue highlights
- **Data tables**: Alternating row colors using gray scale
- **Action buttons**: Primary blue for main actions, gray for secondary

## Implementation Notes

### CSS Custom Properties
```css
:root {
  /* Actor Colors */
  --actor-primary: #2563EB;
  --actor-secondary: #10B981;
  --actor-tertiary: #F59E0B;
  --actor-quaternary: #8B5CF6;
  --actor-quinary: #F43F5E;
  
  /* UI Colors */
  --bg-primary: #FFFFFF;
  --bg-secondary: #F8FAFC;
  --text-primary: #0F172A;
  --text-secondary: #64748B;
  
  /* Fonts */
  --font-primary: 'Inter', sans-serif;
  --font-mono: 'JetBrains Mono', monospace;
}
```

This design system provides a solid foundation for TOTeM Tool while maintaining consistency, accessibility, and professional appearance across all components and visualizations.