/** Transition map — defines valid transitions and blend times. */

import type { AnimationConfig, TransitionsConfig } from "./animation-state.js";

export interface Transition {
  from: string;
  to: string;
  blendTime: number;
}

/** Build the full transition map from animation configs. */
export function buildTransitionMap(
  animations: Record<string, AnimationConfig>,
  config: TransitionsConfig,
): Transition[] {
  const transitions: Transition[] = [];
  const blend = config.default_blend;
  const locomotion = Object.keys(animations).filter(
    (k) => animations[k].category === "locomotion",
  );
  const actions = Object.keys(animations).filter(
    (k) => !animations[k].interruptible && k !== "death",
  );

  // Locomotion ↔ locomotion (all interruptible, can transition freely)
  for (const from of locomotion) {
    for (const to of locomotion) {
      if (from !== to) {
        transitions.push({ from, to, blendTime: blend });
      }
    }
  }

  // Locomotion → any action (attack, jump, cast, etc.)
  for (const from of locomotion) {
    for (const action of actions) {
      transitions.push({ from, to: action, blendTime: 0.1 });
    }
  }

  // Any action → auto_return (idle) when completed
  for (const action of actions) {
    transitions.push({
      from: action,
      to: config.auto_return,
      blendTime: 0.1,
    });
  }

  return transitions;
}

/** Check if a transition from → to is valid. */
export function canTransition(
  transitions: Transition[],
  from: string,
  to: string,
): Transition | null {
  return transitions.find((t) => t.from === from && t.to === to) ?? null;
}
