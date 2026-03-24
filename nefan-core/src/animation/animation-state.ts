/** Animation state types and configuration. */

export type AnimCategory = "locomotion" | "combat" | "reaction" | "special";

export interface AnimationConfig {
  duration: number;
  interruptible: boolean;
  loops: boolean;
  category: AnimCategory;
}

export interface TransitionsConfig {
  default_blend: number;
  auto_return: string;
  turn_threshold_deg: number;
}

export interface AnimEvent {
  type: "state_changed" | "animation_completed" | "action_queued";
  from?: string;
  to?: string;
  blendTime?: number;
}

export function loadAnimationConfigs(
  configJson: Record<string, unknown>,
): { animations: Record<string, AnimationConfig>; transitions: TransitionsConfig } {
  const animations = (configJson.animations ?? {}) as Record<string, AnimationConfig>;
  const transitions = (configJson.transitions ?? {
    default_blend: 0.15,
    auto_return: "idle",
    turn_threshold_deg: 90,
  }) as TransitionsConfig;
  return { animations, transitions };
}
