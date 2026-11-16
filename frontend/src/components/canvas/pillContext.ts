/**
 * Whether the control pill stands upright (at the middle of the left or right
 * edge), for controls inside it that change their shape then, e.g. a slider
 * turning vertical. Kept apart from ControlPill.tsx, which exports components
 * only (Fast Refresh).
 */
import { createContext } from 'react';

export const PillVerticalContext = createContext(false);
