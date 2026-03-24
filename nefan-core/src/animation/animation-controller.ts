/** Animation state machine — manages transitions, queuing, and timing.
 *
 * tick() each frame with delta + movement inputs.
 * requestAction() to queue combat/special actions.
 * The controller decides when and how to transition. */

import type { AnimationConfig, TransitionsConfig, AnimEvent } from "./animation-state.js";
import { buildTransitionMap, canTransition, type Transition } from "./animation-transitions.js";

export interface AnimInputs {
  speed: number;       // current movement speed (0 = idle)
  turning: boolean;    // significant direction change detected
  sprintSpeed: number; // threshold for walk → run
}

export class AnimationController {
  currentState: string;
  currentTime: number = 0;
  queue: string[] = [];

  private animations: Record<string, AnimationConfig>;
  private config: TransitionsConfig;
  private transitions: Transition[];

  constructor(
    animations: Record<string, AnimationConfig>,
    config: TransitionsConfig,
  ) {
    this.animations = animations;
    this.config = config;
    this.transitions = buildTransitionMap(animations, config);
    this.currentState = "idle";
  }

  /** Advance animation time and handle transitions. Returns events. */
  tick(delta: number, inputs: AnimInputs): AnimEvent[] {
    const events: AnimEvent[] = [];
    const current = this.animations[this.currentState];
    if (!current) return events;

    this.currentTime += delta;

    // Non-looping animation completed
    if (!current.loops && this.currentTime >= current.duration) {
      // Check queue first
      if (this.queue.length > 0) {
        const next = this.queue.shift()!;
        events.push(...this.transitionTo(next));
      } else {
        // Auto-return to idle
        events.push(...this.transitionTo(this.config.auto_return));
        events.push({ type: "animation_completed", from: this.currentState });
      }
      return events;
    }

    // Only handle movement inputs if current state is interruptible
    if (!current.interruptible) return events;

    // Handle turning (insert turn animation)
    if (inputs.turning && this.currentState !== "turn") {
      const t = canTransition(this.transitions, this.currentState, "turn");
      if (t) {
        events.push(...this.transitionTo("turn", t.blendTime));
        return events;
      }
    }

    // Handle locomotion based on speed
    const targetState = this.getLocomotionState(inputs.speed, inputs.sprintSpeed);
    if (targetState !== this.currentState) {
      const t = canTransition(this.transitions, this.currentState, targetState);
      if (t) {
        events.push(...this.transitionTo(targetState, t.blendTime));
      }
    }

    return events;
  }

  /** Request a combat/special action. Queues if current is non-interruptible. */
  requestAction(action: string): AnimEvent[] {
    const events: AnimEvent[] = [];
    if (!this.animations[action]) return events;

    const current = this.animations[this.currentState];

    if (current?.interruptible) {
      // Interrupt and transition immediately
      const t = canTransition(this.transitions, this.currentState, action);
      if (t) {
        events.push(...this.transitionTo(action, t.blendTime));
      }
    } else {
      // Queue for later
      if (this.queue.length < 3) { // max queue size
        this.queue.push(action);
        events.push({ type: "action_queued", to: action });
      }
    }

    return events;
  }

  /** Force state (for external sync, e.g., hit/death from combat system). */
  forceState(state: string): AnimEvent[] {
    return this.transitionTo(state, 0);
  }

  /** Get current animation config. */
  getCurrentConfig(): AnimationConfig | undefined {
    return this.animations[this.currentState];
  }

  /** Is the current animation interruptible? */
  isInterruptible(): boolean {
    return this.animations[this.currentState]?.interruptible ?? true;
  }

  /** Progress through current animation (0-1). */
  getProgress(): number {
    const config = this.animations[this.currentState];
    if (!config || config.duration <= 0) return 0;
    if (config.loops) return (this.currentTime % config.duration) / config.duration;
    return Math.min(this.currentTime / config.duration, 1);
  }

  private transitionTo(state: string, blendTime?: number): AnimEvent[] {
    const blend = blendTime ?? this.config.default_blend;
    const from = this.currentState;
    this.currentState = state;
    this.currentTime = 0;
    return [{
      type: "state_changed",
      from,
      to: state,
      blendTime: blend,
    }];
  }

  private getLocomotionState(speed: number, sprintSpeed: number): string {
    if (speed < 0.1) return "idle";
    if (speed > sprintSpeed * 0.7) return "run";
    return "walk";
  }
}
